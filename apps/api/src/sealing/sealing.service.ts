import type { Readable } from 'node:stream';
import { receivesSigningLink, recipientsDueInvitation } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import type { DocumentField, Recipient } from '../generated/prisma/client';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, signedVersionKey } from '../storage/storage.service';
import { PdfSealingService, type StampField, type StampImages } from './pdf-sealing.service';

/** Envelope statuses in which signatures are still being stamped. */
const SEALABLE = new Set(['SENT', 'DELIVERED', 'PARTIALLY_SIGNED']);
/** A round holds the envelope's seal lock while it reads, stamps and stores one version. */
const ROUND_TIMEOUT_MS = 120_000;

export type RoundResult =
  | { kind: 'stamped'; versionNumber: number; recipientId: string; invited: string[] }
  | { kind: 'idle'; reason: string };

export interface CatchUpResult {
  stamped: number;
  /** Why the last round found nothing more to do. */
  reason: string;
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
      if (round.kind === 'idle') return { stamped, reason: round.reason };
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
        if (!SEALABLE.has(envelope.status)) {
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
        if (!next) return { kind: 'idle', reason: 'nothing to stamp' } as const;

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
