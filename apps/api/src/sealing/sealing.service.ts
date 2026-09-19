import type { Readable } from 'node:stream';
import { isOpenEnvelope, receivesSigningLink, recipientsDueInvitation } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import type {
  AuditTrail,
  DocumentField,
  DocumentVersion,
  Envelope,
  Recipient,
} from '../generated/prisma/client';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, sealedVersionKey, signedVersionKey } from '../storage/storage.service';
import type { CertificateData } from './certificate';
import { PdfSealingService, type StampField, type StampImages } from './pdf-sealing.service';

/** A round holds the envelope's seal lock while it reads, stamps and stores one version. */
const ROUND_TIMEOUT_MS = 120_000;
const NOTHING_TO_STAMP = 'nothing to stamp';
const ENVELOPE_COMPLETED = 'envelope completed';

export type RoundResult =
  | { kind: 'stamped'; versionNumber: number; recipientId: string; invited: string[] }
  | { kind: 'idle'; reason: string };

export type SealResult =
  | { kind: 'sealed'; versionNumber: number; sha256: string }
  | { kind: 'idle'; reason: string };

export interface CatchUpResult {
  stamped: number;
  /** Why the last round found nothing more to do. */
  reason: string;
  /** Present when this run sealed the envelope. */
  sealed?: { versionNumber: number; sha256: string };
}

async function bytesOf(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function toStampField(field: DocumentField): StampField {
  return {
    id: field.id,
    pageNumber: field.pageNumber,
    type: field.type,
    value: field.value,
    ratioX: field.ratioX,
    ratioY: field.ratioY,
    ratioWidth: field.ratioWidth,
    ratioHeight: field.ratioHeight,
  };
}

/** Signed, and a signer or approver: someone whose fields go into a version. */
function hasSigned(recipient: Pick<Recipient, 'role' | 'status'>): boolean {
  return receivesSigningLink(recipient.role) && recipient.status === 'SIGNED';
}

/**
 * Turns signatures into document versions, one signer at a time (ADR 0003,
 * ADR 0006). Runs on the worker.
 *
 * Each round takes a per-envelope advisory lock, so two jobs for one envelope
 * never stamp side by side, while declines, reads and other envelopes carry on.
 * The work comes from the database, not from the job: the oldest signature not
 * yet in a version is stamped onto the newest version, stored under a fixed
 * key, and committed by inserting its `DocumentVersion` row. Retries, duplicate
 * jobs and crashes cannot produce a gap or a second copy.
 */
@Injectable()
export class SealingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: PdfSealingService,
    private readonly audit: AuditService,
    private readonly mail: MailQueueService,
    @InjectPinoLogger(SealingService.name) private readonly logger: PinoLogger,
  ) {}

  /** Stamps every outstanding signature on the envelope, oldest first. */
  async catchUp(envelopeId: string): Promise<CatchUpResult> {
    let stamped = 0;
    for (;;) {
      const round = await this.stampNext(envelopeId);
      if (round.kind === 'idle') {
        if (round.reason === ENVELOPE_COMPLETED) {
          // A retry after the emails could not be queued. Queueing is
          // idempotent, and the mailer skips anyone already sent their copy.
          await this.queueCompletionEmails(envelopeId);
        }
        if (round.reason !== NOTHING_TO_STAMP) return { stamped, reason: round.reason };
        // Every signature so far is in a version: if that is everyone, seal.
        const seal = await this.sealFinal(envelopeId);
        if (seal.kind === 'idle') return { stamped, reason: round.reason };
        await this.queueCompletionEmails(envelopeId);
        return {
          stamped,
          reason: 'sealed',
          sealed: { versionNumber: seal.versionNumber, sha256: seal.sha256 },
        };
      }
      stamped += 1;
      for (const recipientId of round.invited) {
        try {
          await this.mail.enqueueSigningLink('invitation', envelopeId, recipientId);
        } catch (error) {
          this.logger.error(
            { err: error, alert: true, envelopeId, nextRecipientId: recipientId },
            'Next invitation could not be queued; a reminder will send it',
          );
        }
      }
    }
  }

  /**
   * One completion email per recipient, whatever their role, and one for the
   * sender (docs/15 step 6). A failure is thrown, so the seal job is retried
   * and queues them again.
   */
  private async queueCompletionEmails(envelopeId: string): Promise<void> {
    const recipients = await this.prisma.recipient.findMany({
      where: { envelopeId },
      select: { id: true },
      orderBy: { routingOrder: 'asc' },
    });
    try {
      for (const { id } of recipients) await this.mail.enqueueCompleted(envelopeId, id);
      await this.mail.enqueueCompleted(envelopeId, null);
    } catch (error) {
      this.logger.error(
        { err: error, alert: true, envelopeId },
        'Completion emails could not be queued; the seal job will retry',
      );
      throw error;
    }
    this.logger.info({ envelopeId, recipients: recipients.length }, 'Completion emails queued');
  }

  /** One round: the oldest signature not yet in a version becomes the next version. */
  stampNext(envelopeId: string): Promise<RoundResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // Held until this transaction ends. Only sealing takes it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seal:${envelopeId}`}, 0))`;

        const envelope = await tx.envelope.findUnique({
          where: { id: envelopeId },
          include: {
            recipients: true,
            versions: {
              select: {
                versionNumber: true,
                fileUrl: true,
                createdByRecipientId: true,
                isFinal: true,
              },
              orderBy: { versionNumber: 'asc' },
            },
          },
        });
        if (!envelope) return { kind: 'idle', reason: 'envelope not found' } as const;
        if (!isOpenEnvelope(envelope.status)) {
          return { kind: 'idle', reason: `envelope ${envelope.status.toLowerCase()}` } as const;
        }

        const stamped = new Set(
          envelope.versions.flatMap((v) =>
            v.createdByRecipientId ? [v.createdByRecipientId] : [],
          ),
        );
        const next = envelope.recipients
          .filter((r) => hasSigned(r) && !stamped.has(r.id))
          .sort(
            (a, b) =>
              (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0) ||
              a.id.localeCompare(b.id),
          )[0];
        if (!next) return { kind: 'idle', reason: NOTHING_TO_STAMP } as const;

        const latest = envelope.versions.at(-1);
        if (!latest) throw new Error(`Envelope ${envelopeId} has no version 0`);
        if (latest.isFinal) return { kind: 'idle', reason: 'already sealed' } as const;

        const fields = await tx.documentField.findMany({
          where: { envelopeId, recipientId: next.id },
        });
        const images = await this.adoptedImages(next, fields);
        const source = await bytesOf((await this.storage.get(latest.fileUrl)).body);
        const result = await this.pdf.burnFields(source, fields.map(toStampField), images);

        const versionNumber = latest.versionNumber + 1;
        const key = signedVersionKey(envelope.tenantId, envelopeId, versionNumber);
        // A fixed key: a retry after a failed insert rewrites the same file (ADR 0006).
        await this.storage.put(key, result.buffer, {
          contentType: 'application/pdf',
          metadata: { sha256: result.sha256 },
        });
        await tx.documentVersion.create({
          data: {
            envelopeId,
            versionNumber,
            fileUrl: key,
            hash: result.sha256,
            pageCount: result.pageCount,
            sizeBytes: result.buffer.length,
            createdByRecipientId: next.id,
          },
        });
        await this.audit.record(tx, {
          envelopeId,
          recipientId: next.id,
          action: 'VERSION_CREATED',
          ...SYSTEM_ACTOR,
          metadata: { versionNumber, sha256: result.sha256, basedOn: latest.versionNumber },
        });

        // One after another: the next group's turn begins once this signature is
        // on the document they will see.
        stamped.add(next.id);
        const due = recipientsDueInvitation(
          envelope.recipients,
          envelope.sequentialSigning,
          stamped,
        );
        if (due.length > 0) {
          await tx.recipient.updateMany({
            where: { envelopeId, id: { in: due.map((r) => r.id) }, status: 'PENDING' },
            data: { status: 'SENT', invitedAt: new Date() },
          });
        }

        this.logger.info(
          {
            envelopeId,
            recipientId: next.id,
            versionNumber,
            sha256: result.sha256,
            bytes: result.buffer.length,
            nextInvited: due.length,
          },
          'Version created',
        );
        return {
          kind: 'stamped',
          versionNumber,
          recipientId: next.id,
          invited: due.map((r) => r.id),
        } as const;
      },
      { timeout: ROUND_TIMEOUT_MS, maxWait: 15_000 },
    );
  }

  /**
   * Once every signer and approver is in a version: appends the certificate to
   * the newest version, stores the result in the locked bucket as the final
   * version, and completes the envelope (docs/15 step 5, ADR 0007).
   *
   * Takes the same lock as a round. A second run finds the envelope completed
   * and does nothing. A retry after the file was stored but before the commit
   * stores it again: the lock keeps the first copy as an unreferenced object
   * version, with the same bytes, and reads always name the recorded version.
   */
  sealFinal(envelopeId: string): Promise<SealResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seal:${envelopeId}`}, 0))`;

        const envelope = await tx.envelope.findUnique({
          where: { id: envelopeId },
          include: {
            owner: { select: { fullName: true } },
            recipients: true,
            versions: { orderBy: { versionNumber: 'asc' } },
            auditLogs: { orderBy: { sequence: 'asc' } },
          },
        });
        if (!envelope) return { kind: 'idle', reason: 'envelope not found' } as const;
        if (!isOpenEnvelope(envelope.status)) {
          return { kind: 'idle', reason: `envelope ${envelope.status.toLowerCase()}` } as const;
        }
        const latest = envelope.versions.at(-1);
        if (!latest) throw new Error(`Envelope ${envelopeId} has no version 0`);
        if (latest.isFinal) return { kind: 'idle', reason: 'already sealed' } as const;

        const parties = envelope.recipients.filter((r) => receivesSigningLink(r.role));
        const stamped = new Set(envelope.versions.map((v) => v.createdByRecipientId));
        const waiting = parties.filter((r) => !hasSigned(r) || !stamped.has(r.id)).length;
        if (parties.length === 0 || waiting > 0) {
          return { kind: 'idle', reason: 'waiting for signatures' } as const;
        }

        const data = this.certificateData(envelope, parties);
        const source = await bytesOf((await this.storage.get(latest.fileUrl)).body);
        const result = await this.pdf.appendCertificate(source, data);

        const versionNumber = latest.versionNumber + 1;
        const key = sealedVersionKey(envelope.tenantId, envelopeId);
        const { versionId, retainUntil } = await this.storage.putSealed(key, result.buffer, {
          contentType: 'application/pdf',
          metadata: { sha256: result.sha256 },
        });
        const completedAt = new Date();
        await tx.documentVersion.create({
          data: {
            envelopeId,
            versionNumber,
            fileUrl: key,
            hash: result.sha256,
            pageCount: result.pageCount,
            sizeBytes: result.buffer.length,
            isFinal: true,
            storageVersionId: versionId,
          },
        });
        await tx.envelope.update({
          where: { id: envelopeId },
          data: {
            status: 'COMPLETED',
            finalHash: result.sha256,
            completedFileUrl: key,
            completedAt,
          },
        });
        await this.audit.record(tx, {
          envelopeId,
          action: 'ENVELOPE_COMPLETED',
          ...SYSTEM_ACTOR,
          metadata: {
            versionNumber,
            sha256: result.sha256,
            basedOn: latest.versionNumber,
            certificatePages: result.certificatePages,
          },
        });

        this.logger.info(
          {
            envelopeId,
            versionNumber,
            sha256: result.sha256,
            bytes: result.buffer.length,
            certificatePages: result.certificatePages,
            retainUntil: retainUntil.toISOString(),
          },
          'Envelope sealed',
        );
        return { kind: 'sealed', versionNumber, sha256: result.sha256 } as const;
      },
      { timeout: ROUND_TIMEOUT_MS, maxWait: 15_000 },
    );
  }

  /** What the certificate prints, taken from the records only (never the clock). */
  private certificateData(
    envelope: Envelope & {
      owner: { fullName: string };
      recipients: Recipient[];
      versions: DocumentVersion[];
      auditLogs: AuditTrail[];
    },
    parties: Recipient[],
  ): CertificateData {
    const names = new Map(envelope.recipients.map((r) => [r.id, r.name]));
    const signedEvents = new Map(
      envelope.auditLogs
        .filter((event) => event.action === 'RECIPIENT_SIGNED' && event.recipientId)
        .map((event) => [event.recipientId, event]),
    );
    const actor = (event: AuditTrail) => {
      if (event.recipientId) return names.get(event.recipientId) ?? 'Recipient';
      if (event.actorUserId) {
        return event.actorUserId === envelope.ownerId ? envelope.owner.fullName : 'Sender';
      }
      return 'System';
    };

    const ordered = [...parties].sort(
      (a, b) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0),
    );
    return {
      envelopeId: envelope.id,
      title: envelope.title,
      originalFilename: envelope.originalFilename,
      sender: envelope.owner.fullName,
      sentAt: envelope.sentAt,
      signedByAllAt: ordered.at(-1)?.signedAt ?? envelope.versions.at(-1)?.createdAt ?? new Date(0),
      parties: ordered.map((party) => {
        const signed = signedEvents.get(party.id);
        const metadata = (signed?.metadata ?? {}) as { documentVersion?: number | null };
        return {
          name: party.name,
          email: party.email,
          role: party.role === 'APPROVER' ? 'APPROVER' : 'SIGNER',
          signedAt: party.signedAt ?? signed?.timestamp ?? new Date(0),
          consentGivenAt: party.consentGivenAt,
          ipAddress: signed?.ipAddress ?? 'Not recorded',
          userAgent: signed?.userAgent ?? 'Not recorded',
          signatureMethod: party.signatureMethod,
          documentVersion: metadata.documentVersion ?? null,
        };
      }),
      versions: envelope.versions.map((version) => ({
        versionNumber: version.versionNumber,
        sha256: version.hash,
        createdBy: version.createdByRecipientId
          ? (names.get(version.createdByRecipientId) ?? 'Recipient')
          : null,
        createdAt: version.createdAt,
      })),
      events: envelope.auditLogs.map((event) => ({
        sequence: event.sequence,
        timestamp: event.timestamp,
        action: event.action,
        actor: actor(event),
        ipAddress: event.ipAddress === SYSTEM_ACTOR.ipAddress ? '' : event.ipAddress,
      })),
    };
  }

  /** The signer's adopted images, for the kinds their filled fields need. */
  private async adoptedImages(recipient: Recipient, fields: DocumentField[]): Promise<StampImages> {
    const needs = (type: 'SIGNATURE' | 'INITIALS') =>
      fields.some((field) => field.type === type && field.value !== null);
    const images: StampImages = {};
    if (needs('SIGNATURE') && recipient.signatureImageKey) {
      images.SIGNATURE = await bytesOf((await this.storage.get(recipient.signatureImageKey)).body);
    }
    if (needs('INITIALS') && recipient.initialsImageKey) {
      images.INITIALS = await bytesOf((await this.storage.get(recipient.initialsImageKey)).body);
    }
    return images;
  }
}
