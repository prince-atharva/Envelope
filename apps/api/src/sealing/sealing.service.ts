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
import { lockEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, sealedVersionKey, signedVersionKey } from '../storage/storage.service';
import { WebhookQueueService } from '../webhooks/webhook-queue.service';
import type { CertificateData } from './certificate';
import { PdfSealingService, type StampField, type StampImages } from './pdf-sealing.service';

/** sealFinal still holds the envelope's seal lock while it uploads the locked, final copy. */
const ROUND_TIMEOUT_MS = 120_000;
/** stampNext's write phase, once stamping and upload are already done. */
const WRITE_TIMEOUT_MS = 10_000;
const NOTHING_TO_STAMP = 'nothing to stamp';
const ENVELOPE_COMPLETED = 'envelope completed';
/** Another job's write landed first; catchUp re-reads and calls stampNext again. */
const STALE_SNAPSHOT = 'stale snapshot, retrying';
/** Guards against a pathological cascade of collisions; ordinary contention resolves in 1-2. */
const MAX_STALE_RETRIES = 20;

export type RoundResult =
  | {
      kind: 'stamped';
      versionNumber: number;
      recipientId: string;
      invited: string[];
      invitedAt: Date;
    }
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
    private readonly webhooks: WebhookQueueService,
    @InjectPinoLogger(SealingService.name) private readonly logger: PinoLogger,
  ) {}

  /** Stamps every outstanding signature on the envelope, oldest first. */
  async catchUp(envelopeId: string): Promise<CatchUpResult> {
    let stamped = 0;
    let staleRetries = 0;
    for (;;) {
      const round = await this.stampNext(envelopeId);
      if (round.kind === 'idle') {
        if (round.reason === STALE_SNAPSHOT) {
          // Another job (stamping a different envelope's signature, or a
          // retry of this one) committed its version between this job's
          // read and its write. Re-read and try again: self-limiting, since
          // each retry either wins or observes one more committed version.
          staleRetries += 1;
          if (staleRetries > MAX_STALE_RETRIES) {
            throw new Error(
              `Envelope ${envelopeId}: gave up after ${MAX_STALE_RETRIES} stale snapshots in a row`,
            );
          }
          continue;
        }
        if (round.reason === ENVELOPE_COMPLETED) {
          // A retry after the emails could not be queued. Queueing is
          // idempotent, and the mailer skips anyone already sent their copy.
          await this.queueCompletionEmails(envelopeId);
        }
        if (round.reason !== NOTHING_TO_STAMP) return { stamped, reason: round.reason };
        // Every signature so far is in a version: if that is everyone, seal.
        const seal = await this.sealFinal(envelopeId);
        if (seal.kind === 'idle') {
          if (seal.reason === STALE_SNAPSHOT) {
            // Someone stamped one more signature while the certificate was
            // being built. Loop back to stampNext, which will find it.
            staleRetries += 1;
            if (staleRetries > MAX_STALE_RETRIES) {
              throw new Error(
                `Envelope ${envelopeId}: gave up after ${MAX_STALE_RETRIES} stale snapshots in a row`,
              );
            }
            continue;
          }
          return { stamped, reason: round.reason };
        }
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
          await this.mail.enqueueSigningLink(
            'invitation',
            envelopeId,
            recipientId,
            round.invitedAt,
          );
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

  /**
   * One round: the oldest signature not yet in a version becomes the next
   * version. Read, stamp and upload happen with no lock held (100M-row scale
   * follow-up, docs/16 step 14 — this used to hold the seal lock, and the
   * connection behind it, for the whole thing, up to 120s). Two jobs for the
   * same envelope can therefore both reach this point for the same
   * signature; only one write phase can find `latest` still current, so at
   * most one of them ever creates a version. The loser returns
   * STALE_SNAPSHOT, and catchUp's loop calls stampNext again, which re-reads
   * fresh state (typically finding the winner's version already there, and
   * moving on to whichever signature is next).
   */
  async stampNext(envelopeId: string): Promise<RoundResult> {
    const envelope = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: {
        recipients: true,
        versions: {
          select: { versionNumber: true, fileUrl: true, createdByRecipientId: true, isFinal: true },
          orderBy: { versionNumber: 'asc' },
        },
      },
    });
    if (!envelope) return { kind: 'idle', reason: 'envelope not found' } as const;
    if (!isOpenEnvelope(envelope.status)) {
      return { kind: 'idle', reason: `envelope ${envelope.status.toLowerCase()}` } as const;
    }

    const stampedBefore = new Set(
      envelope.versions.flatMap((v) => (v.createdByRecipientId ? [v.createdByRecipientId] : [])),
    );
    const next = envelope.recipients
      .filter((r) => hasSigned(r) && !stampedBefore.has(r.id))
      .sort(
        (a, b) =>
          (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
      )[0];
    if (!next) return { kind: 'idle', reason: NOTHING_TO_STAMP } as const;

    const latest = envelope.versions.at(-1);
    if (!latest) throw new Error(`Envelope ${envelopeId} has no version 0`);
    if (latest.isFinal) return { kind: 'idle', reason: 'already sealed' } as const;

    const fields = await this.prisma.documentField.findMany({
      where: { envelopeId, recipientId: next.id },
    });
    const images = await this.adoptedImages(next, fields);
    const source = await bytesOf((await this.storage.get(latest.fileUrl)).body);
    const result = await this.pdf.burnFields(source, fields.map(toStampField), images);

    const versionNumber = latest.versionNumber + 1;
    // Content-addressed, not fixed by version number (see signedVersionKey):
    // a concurrent loser's upload of the same signature either lands on this
    // same key (harmless) or on a key nothing ever references (wasted, not
    // wrong) — never overwrites bytes a committed DocumentVersion row names.
    const key = signedVersionKey(envelope.tenantId, envelopeId, result.sha256);
    await this.storage.put(key, result.buffer, {
      contentType: 'application/pdf',
      metadata: { sha256: result.sha256 },
    });

    // Write phase: short, no external I/O. Holds the seal lock only long
    // enough to check nobody else already moved `latest` and to write.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seal:${envelopeId}`}, 0))`;

        // The envelope may have been cancelled while the file was stamped. The row
        // lock is taken only now, so a cancel never waits for storage work.
        const current = await lockEnvelope(tx, envelopeId);
        if (!current || !isOpenEnvelope(current)) {
          this.logger.info(
            { envelopeId, recipientId: next.id, status: current },
            'Envelope closed while stamping; version not created',
          );
          return { kind: 'idle', reason: `envelope ${current?.toLowerCase() ?? 'gone'}` } as const;
        }

        const stillLatest = await tx.documentVersion.findFirst({
          where: { envelopeId },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        if (stillLatest?.versionNumber !== latest.versionNumber) {
          this.logger.info(
            {
              envelopeId,
              recipientId: next.id,
              expectedLatest: latest.versionNumber,
              actualLatest: stillLatest?.versionNumber,
            },
            'Another job stamped this envelope first; this snapshot is stale',
          );
          return { kind: 'idle', reason: STALE_SNAPSHOT } as const;
        }

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
        const stampedNow = new Set(stampedBefore).add(next.id);
        const due = recipientsDueInvitation(
          envelope.recipients,
          envelope.sequentialSigning,
          stampedNow,
        );
        const invitedAt = new Date();
        if (due.length > 0) {
          await tx.recipient.updateMany({
            where: { envelopeId, id: { in: due.map((r) => r.id) }, status: 'PENDING' },
            data: { status: 'SENT', invitedAt },
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
          invitedAt,
        } as const;
      },
      { timeout: WRITE_TIMEOUT_MS, maxWait: 5_000 },
    );
  }

  /**
   * Once every signer and approver is in a version: appends the certificate to
   * the newest version, stores the result in the locked bucket as the final
   * version, and completes the envelope (docs/15 step 5, ADR 0007).
   *
   * Building the certificate (a plain read, then CPU work) happens with no
   * lock held. Only the write below is irreversible (Object Lock), so only
   * that is done under the seal lock (100M-row scale follow-up, docs/16 step
   * 14) — and, unlike before, the envelope's row lock is now taken *before*
   * that write rather than after: a concurrent cancel or a newer signature
   * either already committed (caught by the checks below, before anything is
   * written to the locked bucket) or blocks behind this transaction's row
   * lock until it commits, so a losing race here can no longer leave a
   * locked, unreferenced object behind. A retry after a crash between the
   * write and the commit stores the same file again: reads always name the
   * version id recorded with the row, never reconstruct the key.
   */
  async sealFinal(envelopeId: string): Promise<SealResult> {
    const envelope = await this.prisma.envelope.findUnique({
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
    const stampedBefore = new Set(envelope.versions.map((v) => v.createdByRecipientId));
    const waiting = parties.filter((r) => !hasSigned(r) || !stampedBefore.has(r.id)).length;
    if (parties.length === 0 || waiting > 0) {
      return { kind: 'idle', reason: 'waiting for signatures' } as const;
    }

    const data = this.certificateData(envelope, parties);
    const source = await bytesOf((await this.storage.get(latest.fileUrl)).body);
    const result = await this.pdf.appendCertificate(source, data);

    const sealResult = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seal:${envelopeId}`}, 0))`;

        // Taken, and checked, before the locked write below — not after, as a
        // round's does — so nothing is ever written to the locked bucket for
        // an envelope a concurrent cancel has already closed.
        const current = await lockEnvelope(tx, envelopeId);
        if (!current || !isOpenEnvelope(current)) {
          this.logger.warn(
            { envelopeId, status: current },
            'Envelope closed while building the certificate; not sealed',
          );
          return { kind: 'idle', reason: `envelope ${current?.toLowerCase() ?? 'gone'}` } as const;
        }
        const stillLatest = await tx.documentVersion.findFirst({
          where: { envelopeId },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true, isFinal: true },
        });
        if (stillLatest?.isFinal) return { kind: 'idle', reason: 'already sealed' } as const;
        if (stillLatest?.versionNumber !== latest.versionNumber) {
          this.logger.info(
            {
              envelopeId,
              expectedLatest: latest.versionNumber,
              actualLatest: stillLatest?.versionNumber,
            },
            'Another version landed while building the certificate; this snapshot is stale',
          );
          return { kind: 'idle', reason: STALE_SNAPSHOT } as const;
        }

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

    if (sealResult.kind === 'sealed') {
      await this.webhooks.enqueue(envelope.tenantId, 'envelope.completed', {
        envelopeId,
        envelopeStatus: 'COMPLETED',
        completedAt: new Date().toISOString(),
        finalVersionNumber: sealResult.versionNumber,
        finalHash: sealResult.sha256,
      });
    }
    return sealResult;
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
