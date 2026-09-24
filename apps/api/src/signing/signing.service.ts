import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  type AdoptSignatureInput,
  type AdoptSignatureResponse,
  type ConsentInput,
  type ConsentResponse,
  type DeclineInput,
  type DeclineResponse,
  type MoreTimeResponse,
  OPEN_ENVELOPE_STATUSES,
  orderFieldsForSigning,
  type SigningSession,
  type SubmitSigningInput,
  type SubmitSigningResponse,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { Prisma } from '../generated/prisma/client';
import { MailQueueService } from '../mail/mail-queue.service';
import { lockOpenEnvelope } from '../prisma/envelope-locks';
import { PrismaService } from '../prisma/prisma.service';
import { SealQueueService } from '../sealing/seal-queue.service';
import { StorageService, signatureImageKey } from '../storage/storage.service';
import { CONSENT_TEXT_IS_DRAFT, consentNoticeFor } from './consent-text';
import { resolveFieldValues } from './field-values';
import { parseSignatureImage } from './signature-image';
import { type SignerContext, TokenGuardianService } from './token-guardian.service';

/** Invited and not yet finished. */
const AWAITING = ['SENT', 'DELIVERED', 'VIEWED'] as const;
/** Envelope statuses in which a signer can act. */
const MAX_USER_AGENT_LENGTH = 500;
/** Explicit, rather than Prisma's default: submit() holds the envelope's row lock. */
const SUBMIT_TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 5_000 };

export interface SignerDocument {
  body: Readable;
  sizeBytes: number;
}

function requireConsent(signer: SignerContext): void {
  if (!signer.recipient.consentGivenAt) {
    throw new AppException('CONSENT_REQUIRED', 'Agree to sign electronically first.');
  }
}

/**
 * Everything a signer does through their link (docs/08, "Signing Session").
 *
 * Every method starts by resolving the token, which is the signer's only
 * identity. Every query after that is scoped to the envelope and recipient the
 * token names, never to an id from the request body (docs/03). State changes
 * are conditional updates, so a second tab, a double tap or a decline landing
 * at the same moment cannot sign twice or sign a closed envelope.
 */
/** One request for more time per person per day. */
const MORE_TIME_COOLDOWN_MS = 24 * 3600 * 1000;
/** lastSeenAt is written at most this often while someone reads. */
const SEEN_WRITE_EVERY_MS = 10 * 60 * 1000;

@Injectable()
export class SigningService {
  constructor(
    private readonly guardian: TokenGuardianService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mail: MailQueueService,
    private readonly seals: SealQueueService,
    @InjectPinoLogger(SigningService.name) private readonly logger: PinoLogger,
  ) {}

  /** GET /sign/:token. The first visit marks the person as having opened it. */
  async session(rawToken: string, client: ClientInfo): Promise<SigningSession> {
    const signer = await this.guardian.resolve(rawToken);
    const { recipient, envelope } = signer;
    const consented = recipient.consentGivenAt !== null;

    // Nothing about the document itself before consent: the gate is enforced
    // here, not by the page (docs/07, docs/09). None of these three depend
    // on each other's result, so they run together (100M-row scale
    // follow-up, docs/16 step 14).
    const [fields] = await Promise.all([
      consented
        ? this.prisma.documentField.findMany({
            where: { envelopeId: envelope.id, recipientId: recipient.id },
          })
        : Promise.resolve([]),
      this.markSeen(recipient.id),
      recipient.viewedAt
        ? Promise.resolve()
        : this.markFirstView(recipient.id, envelope.id, client),
    ]);

    const notice = consented ? null : consentNoticeFor(envelope.jurisdictionCode);

    return {
      envelopeTitle: envelope.title,
      senderName: envelope.owner.fullName,
      recipientName: recipient.name,
      role: recipient.role === 'APPROVER' ? 'APPROVER' : 'SIGNER',
      pageCount: envelope.pageCount,
      expiresAt: (recipient.tokenExpiresAt ?? envelope.expiresAt ?? new Date()).toISOString(),
      message: envelope.message,
      consentRequired: !consented,
      consentText: notice?.text ?? null,
      consentTextHash: notice?.hash ?? null,
      fields: orderFieldsForSigning(fields).map((field) => ({
        id: field.id,
        type: field.type,
        pageNumber: field.pageNumber,
        required: field.required,
        ratioX: field.ratioX,
        ratioY: field.ratioY,
        ratioWidth: field.ratioWidth,
        ratioHeight: field.ratioHeight,
      })),
      adopted: {
        ...(recipient.signatureMethod ? { SIGNATURE: recipient.signatureMethod } : {}),
        ...(recipient.initialsMethod ? { INITIALS: recipient.initialsMethod } : {}),
      },
    };
  }

  /**
   * GET /sign/:token/document, only after consent: the newest version, with
   * every signature stamped so far (ADR 0003). The version served is recorded
   * on the recipient, and their signature records it as what they attested to.
   */
  async document(rawToken: string): Promise<SignerDocument> {
    const signer = await this.guardian.resolve(rawToken);
    requireConsent(signer);
    const { recipient, envelope } = signer;

    // Independent reads (100M-row scale follow-up, docs/16 step 14).
    const [, version] = await Promise.all([
      this.markSeen(recipient.id),
      this.prisma.documentVersion.findFirst({
        where: { envelopeId: envelope.id, isFinal: false },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true, fileUrl: true, sizeBytes: true },
      }),
    ]);
    if (!version) throw new AppException('NOT_FOUND', 'Document not found.');

    if (recipient.servedVersionNumber !== version.versionNumber) {
      // Only while they can still sign: a signature, once given, names its version.
      await this.prisma.recipient.updateMany({
        where: { id: recipient.id, tokenUsedAt: null },
        data: { servedVersionNumber: version.versionNumber },
      });
    }

    const object = await this.storage.get(version.fileUrl);
    this.logger.info(
      { versionNumber: version.versionNumber, sizeBytes: version.sizeBytes },
      'Signer opened the document',
    );
    return { body: object.body, sizeBytes: version.sizeBytes };
  }

  /** POST /sign/:token/consent. Stores the exact notice that was shown (docs/07). */
  async consent(
    rawToken: string,
    input: ConsentInput,
    client: ClientInfo,
  ): Promise<ConsentResponse> {
    const signer = await this.guardian.resolve(rawToken);
    const { recipient, envelope } = signer;
    if (recipient.consentGivenAt) {
      return { consentGivenAt: recipient.consentGivenAt.toISOString() };
    }

    const notice = consentNoticeFor(envelope.jurisdictionCode);
    if (input.consentTextHash !== notice.hash) {
      this.logger.info('Consent refused: the notice changed after it was shown');
      throw new AppException(
        'CONSENT_TEXT_CHANGED',
        'The notice has been updated. Please read it again before agreeing.',
      );
    }

    const now = new Date();
    const given = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOpenEnvelope(tx, envelope.id, now))) return null;
      const claimed = await tx.recipient.updateMany({
        where: { id: recipient.id, consentGivenAt: null },
        data: { consentGivenAt: now, consentText: notice.text },
      });
      if (claimed.count === 0) {
        const current = await tx.recipient.findUniqueOrThrow({
          where: { id: recipient.id },
          select: { consentGivenAt: true },
        });
        return current.consentGivenAt ?? now;
      }
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'CONSENT_GIVEN',
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          textSha256: notice.hash,
          jurisdiction: envelope.jurisdictionCode,
          draftText: CONSENT_TEXT_IS_DRAFT,
        },
      });
      return now;
    });
    if (!given) {
      await this.guardian.resolve(rawToken); // Throws the reason: closed or expired.
      throw new AppException('CONFLICT', 'Please reload and try again.');
    }

    this.logger.info({ draftText: CONSENT_TEXT_IS_DRAFT }, 'Signer agreed to sign electronically');
    return { consentGivenAt: given.toISOString() };
  }

  /**
   * POST /sign/:token/adopt: "Adopt & Sign" (docs/07). Stores one image per
   * kind; submitting puts it into every matching field.
   */
  async adopt(
    rawToken: string,
    input: AdoptSignatureInput,
    client: ClientInfo,
  ): Promise<AdoptSignatureResponse> {
    const signer = await this.guardian.resolve(rawToken);
    requireConsent(signer);
    const { recipient, envelope } = signer;
    const image = parseSignatureImage(input.image);

    const kind = input.kind === 'SIGNATURE' ? 'signature' : 'initials';
    const key = signatureImageKey(envelope.tenantId, envelope.id, recipient.id, kind, randomUUID());
    await this.storage.put(key, image.bytes, {
      contentType: 'image/png',
      metadata: { sha256: image.sha256 },
    });

    const previousKey =
      input.kind === 'SIGNATURE' ? recipient.signatureImageKey : recipient.initialsImageKey;
    const data =
      input.kind === 'SIGNATURE'
        ? { signatureImageKey: key, signatureMethod: input.method }
        : { initialsImageKey: key, initialsMethod: input.method };

    const adopted = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOpenEnvelope(tx, envelope.id, new Date()))) return false;
      const claimed = await tx.recipient.updateMany({
        where: {
          id: recipient.id,
          tokenUsedAt: null,
          status: { in: [...AWAITING] },
          envelope: { status: { in: [...OPEN_ENVELOPE_STATUSES] } },
        },
        data,
      });
      if (claimed.count === 0) return false;
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'SIGNATURE_ADOPTED',
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          kind: input.kind,
          method: input.method,
          sha256: image.sha256,
          bytes: image.bytes.length,
          width: image.width,
          height: image.height,
        },
      });
      return true;
    });

    if (!adopted) {
      await this.discard(key);
      await this.guardian.resolve(rawToken); // Throws the reason: signed, declined or closed.
      throw new AppException('CONFLICT', 'Please reload and try again.');
    }
    // The replaced image was never put into a field, so nothing refers to it.
    if (previousKey) await this.discard(previousKey);

    this.logger.info(
      { kind: input.kind, method: input.method, bytes: image.bytes.length },
      'Signer adopted a signature',
    );
    return { kind: input.kind, method: input.method };
  }

  /** POST /sign/:token/submit: "Finish". Spends the token (docs/10). */
  async submit(
    rawToken: string,
    input: SubmitSigningInput,
    client: ClientInfo,
  ): Promise<SubmitSigningResponse> {
    const started = performance.now();
    const signer = await this.guardian.resolve(rawToken);
    requireConsent(signer);
    const { recipient, envelope } = signer;

    const fields = await this.prisma.documentField.findMany({
      where: { envelopeId: envelope.id, recipientId: recipient.id },
      select: { id: true, type: true, required: true, pageNumber: true },
    });
    const signedAt = new Date();
    const resolved = resolveFieldValues(fields, input.fields, recipient, signedAt);
    if (!resolved.ok) {
      this.logger.info(
        { problem: resolved.problem, fields: resolved.fieldIds.length },
        'Submission refused',
      );
      if (resolved.problem === 'INCOMPLETE') {
        throw new AppException(
          'REQUIRED_FIELDS_INCOMPLETE',
          'Some required fields are still empty.',
          {
            errors: resolved.fieldIds.map((id) => ({
              path: `fields.${id}`,
              message: 'This field is required.',
            })),
          },
        );
      }
      throw new AppException(
        'VALIDATION_FAILED',
        'The submission names fields that are not yours.',
        {
          errors: resolved.fieldIds.map((id) => ({
            path: `fields.${id}`,
            message: 'Unknown field.',
          })),
        },
      );
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOpenEnvelope(tx, envelope.id, signedAt))) return null;
      const claimed = await tx.recipient.updateMany({
        where: {
          id: recipient.id,
          tokenUsedAt: null,
          consentGivenAt: { not: null },
          status: { in: [...AWAITING] },
          envelope: { status: { in: [...OPEN_ENVELOPE_STATUSES] } },
        },
        data: {
          status: 'SIGNED',
          signedAt,
          tokenUsedAt: signedAt,
          signedFromIp: client.ip,
          signedFromUa: client.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
        },
      });
      if (claimed.count === 0) return null;

      // One statement for every field, not one round trip each: this holds
      // the envelope's row lock (and, once audit.record runs, the per-
      // envelope advisory lock), so other signers of the same envelope wait
      // on it (100M-row scale follow-up, docs/16 step 14).
      if (resolved.values.length > 0) {
        const rows = Prisma.join(
          resolved.values.map((field) => {
            // `AT TIME ZONE 'UTC'` turns an unambiguous instant into the
            // naive UTC wall-clock value this timestamp(3)-without-time-zone
            // column expects, regardless of the session's own time zone.
            const completedAt = field.isCompleted
              ? Prisma.sql`${signedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'`
              : Prisma.sql`NULL::timestamp`;
            return Prisma.sql`(${field.id}::uuid, ${field.value}::text, ${field.isCompleted}::boolean, ${completedAt})`;
          }),
        );
        await tx.$executeRaw(Prisma.sql`
          UPDATE "DocumentField" AS f
             SET "value" = v.value,
                 "isCompleted" = v."isCompleted",
                 "completedAt" = v."completedAt"
            FROM (VALUES ${rows}) AS v(id, value, "isCompleted", "completedAt")
           WHERE f.id = v.id AND f."envelopeId" = ${envelope.id}::uuid
        `);
      }
      await tx.envelope.updateMany({
        where: { id: envelope.id, status: { in: ['SENT', 'DELIVERED'] } },
        data: { status: 'PARTIALLY_SIGNED' },
      });
      // The version this person was shown, and so attested to (ADR 0003).
      const served =
        recipient.servedVersionNumber === null
          ? null
          : await tx.documentVersion.findUnique({
              where: {
                envelopeId_versionNumber: {
                  envelopeId: envelope.id,
                  versionNumber: recipient.servedVersionNumber,
                },
              },
              select: { versionNumber: true, hash: true },
            });
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'RECIPIENT_SIGNED',
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          fields: resolved.values.filter((field) => field.isCompleted).length,
          signatureMethod: recipient.signatureMethod,
          initialsMethod: recipient.initialsMethod,
          documentVersion: served?.versionNumber ?? null,
          documentSha256: served?.hash ?? null,
        },
      });

      const waiting = await tx.recipient.count({
        where: {
          envelopeId: envelope.id,
          role: { in: ['SIGNER', 'APPROVER'] },
          status: { notIn: ['SIGNED', 'DECLINED'] },
        },
      });
      return { waiting };
      // Explicit rather than Prisma's default: this holds the envelope's row
      // lock, so it should fail fast and free it rather than let other
      // signers of the same envelope queue behind an open-ended wait.
    }, SUBMIT_TRANSACTION_OPTIONS);

    if (!outcome) {
      await this.guardian.resolve(rawToken); // Throws the reason: already signed, declined, closed.
      throw new AppException('CONFLICT', 'Please reload and try again.');
    }

    // The worker stamps the signature into the next version and then, one after
    // another, invites whoever is next (ADR 0006).
    try {
      await this.seals.enqueue(envelope.id, recipient.id);
    } catch (error) {
      this.logger.error(
        { err: error, alert: true },
        'Seal job could not be queued; the signature is saved but not yet stamped',
      );
    }

    this.logger.info(
      {
        fields: resolved.values.length,
        documentVersion: recipient.servedVersionNumber,
        stillToSign: outcome.waiting,
        durationMs: Math.round(performance.now() - started),
      },
      outcome.waiting === 0 ? 'Recipient signed; everyone has now signed' : 'Recipient signed',
    );

    return {
      status: 'SIGNED',
      signedAt: signedAt.toISOString(),
      message:
        recipient.role === 'APPROVER'
          ? 'Your approval has been recorded. The completed document will be emailed once everyone has finished.'
          : 'Your signature has been recorded. The completed document will be emailed once everyone has signed.',
    };
  }

  /**
   * POST /sign/:token/decline. Allowed before consent. Ends the envelope for
   * everyone at once, in the same transaction (docs/03, invariant 3).
   */
  async decline(
    rawToken: string,
    input: DeclineInput,
    client: ClientInfo,
  ): Promise<DeclineResponse> {
    const signer = await this.guardian.resolve(rawToken);
    const { recipient, envelope } = signer;
    const declinedAt = new Date();

    const declined = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOpenEnvelope(tx, envelope.id, declinedAt))) return false;
      const claimed = await tx.recipient.updateMany({
        where: {
          id: recipient.id,
          tokenUsedAt: null,
          status: { in: [...AWAITING] },
          envelope: { status: { in: [...OPEN_ENVELOPE_STATUSES] } },
        },
        data: { status: 'DECLINED', declinedAt, declinedReason: input.reason },
      });
      if (claimed.count === 0) return false;
      await tx.envelope.updateMany({
        where: { id: envelope.id, status: { in: [...OPEN_ENVELOPE_STATUSES] } },
        // declinedAt lets Needs-attention find this without aggregating
        // Recipient (envelope-views.ts).
        data: { status: 'DECLINED', declinedAt },
      });
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'RECIPIENT_DECLINED',
        ipAddress: client.ip,
        userAgent: client.userAgent,
        // The reason itself is on the recipient, shown to the sender only.
        metadata: { reasonLength: input.reason.length },
      });
      return true;
    });

    if (!declined) {
      await this.guardian.resolve(rawToken);
      throw new AppException('CONFLICT', 'Please reload and try again.');
    }

    this.logger.info({ reasonLength: input.reason.length }, 'Recipient declined; envelope closed');
    try {
      await this.mail.enqueueDeclinedNotice(envelope.id, recipient.id);
    } catch (error) {
      // The decline stands either way; the sender still sees it on the envelope page.
      this.logger.error({ err: error, alert: true }, 'Decline notice could not be queued');
    }
    return { status: 'DECLINED', declinedAt: declinedAt.toISOString() };
  }

  /**
   * A signer whose link expired asks the sender for more time (docs/16 step
   * 8). The only thing an expired link can still do. Once a day per person: a
   * second request in that time answers the same, but the sender is not
   * emailed again, so a reload is never an error.
   */
  async requestMoreTime(rawToken: string, client: ClientInfo): Promise<MoreTimeResponse> {
    const now = new Date();
    const signer = await this.guardian.resolve(rawToken, now, { allowExpired: true });
    if (!signer.expired) {
      throw new AppException('CONFLICT', 'Your link still works, so you can sign now.');
    }
    const { recipient, envelope } = signer;

    const claimed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.recipient.updateMany({
        where: {
          id: recipient.id,
          OR: [
            { moreTimeRequestedAt: null },
            { moreTimeRequestedAt: { lt: new Date(now.getTime() - MORE_TIME_COOLDOWN_MS) } },
          ],
        },
        data: { moreTimeRequestedAt: now },
      });
      if (claim.count === 0) return false;
      await this.audit.record(tx, {
        envelopeId: envelope.id,
        recipientId: recipient.id,
        action: 'EXTENSION_REQUESTED',
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: { envelopeStatus: envelope.status },
      });
      return true;
    });

    if (!claimed) {
      this.logger.info('More time already requested in the last day');
      return { requested: true, alreadyRequested: true };
    }

    this.logger.info({ envelopeStatus: envelope.status }, 'More time requested');
    try {
      await this.mail.enqueueMoreTimeRequested(envelope.id, recipient.id, now);
    } catch (error) {
      // Recorded either way; the sender sees the envelope as expired on their dashboard.
      this.logger.error({ err: error, alert: true }, 'More-time request could not be queued');
    }
    return { requested: true, alreadyRequested: false };
  }

  /** The first time a signer opens their link: marks it seen and logs the event. */
  private async markFirstView(
    recipientId: string,
    envelopeId: string,
    client: ClientInfo,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const first = await tx.recipient.updateMany({
        where: { id: recipientId, viewedAt: null },
        data: { viewedAt: now },
      });
      if (first.count === 0) return; // Another tab got here first.
      await tx.recipient.updateMany({
        where: { id: recipientId, status: { in: ['SENT', 'DELIVERED'] } },
        data: { status: 'VIEWED' },
      });
      await this.audit.record(tx, {
        envelopeId,
        recipientId,
        action: 'ENVELOPE_VIEWED',
        ipAddress: client.ip,
        userAgent: client.userAgent,
      });
    });
    this.logger.info('Signer opened the envelope for the first time');
  }

  /**
   * Records that the signer has the document open, at most every 10 minutes.
   * Automatic reminders wait while they do: every reminder carries a new link,
   * which would break the page they are on (docs/16 step 10). Best effort: a
   * failure here never stops them reading.
   */
  private async markSeen(recipientId: string): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.recipient.updateMany({
        where: {
          id: recipientId,
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: new Date(now.getTime() - SEEN_WRITE_EVERY_MS) } },
          ],
        },
        data: { lastSeenAt: now },
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not record that the signer is reading');
    }
  }

  /** Removes an image nothing refers to. A failure only leaves an orphan behind. */
  private async discard(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not delete an unused signature image');
    }
  }
}
