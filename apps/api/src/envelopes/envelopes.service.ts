import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  type CreateEnvelopeInput,
  type EnvelopeCounts,
  type EnvelopeDetail,
  type EnvelopeListResponse,
  type EnvelopeSummary,
  type ListEnvelopesQuery,
  OPEN_ENVELOPE_STATUSES,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import type { Envelope, Recipient } from '../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { envelopeDocumentKey, StorageService } from '../storage/storage.service';
import { PdfValidatorService } from '../uploads/pdf-validator.service';
import {
  attentionCountQuery,
  attentionPageQuery,
  attentionReason,
  decodeAttentionCursor,
  encodeAttentionCursor,
  progressOf,
  viewWhere,
} from './envelope-views';

/** What a list row needs from each recipient, for its progress. */
const PROGRESS_FIELDS = {
  name: true,
  role: true,
  status: true,
  invitedAt: true,
  notifiedAt: true,
  viewedAt: true,
  signedAt: true,
  declinedAt: true,
} as const;

const MAX_FILENAME_LENGTH = 255;
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);
const AUDIT_EVENTS_IN_DETAIL = 100;

/** Multer decodes multipart file names as latin1; recover UTF-8 names where possible. */
export function displayFilename(raw: string): string {
  let name = raw;
  const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
  if (utf8 !== raw && !utf8.includes(REPLACEMENT_CHARACTER)) name = utf8;
  const cleaned = name
    .replace(/^.*[\\/]/, '') // no directories
    .replace(/\p{Cc}/gu, '') // no control characters
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || 'document.pdf';
}

export function titleFromFilename(filename: string): string {
  return (
    filename
      .replace(/\.pdf$/i, '')
      .trim()
      .slice(0, 200) || 'Untitled document'
  );
}

interface Cursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(envelope: Pick<Envelope, 'createdAt' | 'id'>): string {
  return Buffer.from(`${envelope.createdAt.toISOString()}|${envelope.id}`).toString('base64url');
}

function decodeCursor(cursor: string): Cursor {
  const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(timestamp ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new AppException('BAD_REQUEST', 'The page cursor is invalid.');
  }
  return { createdAt, id };
}

/** What a list row needs from the envelope itself, for toSummary/progressOf. */
const LIST_FIELDS = {
  id: true,
  title: true,
  status: true,
  originalFilename: true,
  pageCount: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
  sentAt: true,
  completedAt: true,
} as const;

type ListRow = Pick<Envelope, keyof typeof LIST_FIELDS>;

function toSummary(
  envelope: ListRow,
  recipients: Parameters<typeof progressOf>[1],
): EnvelopeSummary {
  return {
    id: envelope.id,
    title: envelope.title,
    status: envelope.status,
    originalFilename: envelope.originalFilename,
    pageCount: envelope.pageCount,
    createdAt: envelope.createdAt.toISOString(),
    updatedAt: envelope.updatedAt.toISOString(),
    expiresAt: envelope.expiresAt?.toISOString() ?? null,
    progress: progressOf(envelope, recipients),
  };
}

type WithProgressRecipients = ListRow & {
  recipients: Pick<Recipient, keyof typeof PROGRESS_FIELDS>[];
};

export interface OpenedDocument {
  body: Readable;
  sizeBytes: number;
  sha256: string;
  filename: string;
}

@Injectable()
export class EnvelopesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    private readonly validator: PdfValidatorService,
    private readonly audit: AuditService,
    @InjectPinoLogger(EnvelopesService.name) private readonly logger: PinoLogger,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * Upload → validate and sanitise → store under a random key → create the draft
   * envelope, DocumentVersion 0 and the ENVELOPE_CREATED audit event in one
   * transaction. If the database step fails, the stored file is removed again.
   */
  async create(
    user: AuthenticatedUser,
    upload: { buffer: Buffer; originalname: string },
    input: CreateEnvelopeInput,
    client: ClientInfo,
  ): Promise<EnvelopeDetail> {
    const started = performance.now();
    const pdf = await this.validator.validate(upload.buffer);

    const envelopeId = randomUUID();
    const key = envelopeDocumentKey(user.tenantId, envelopeId, 0, randomUUID());
    await this.storage.put(key, pdf.bytes, {
      contentType: 'application/pdf',
      metadata: { sha256: pdf.sha256, 'envelope-id': envelopeId, version: '0' },
    });

    const originalFilename = displayFilename(upload.originalname);
    try {
      await this.db.$transaction(async (tx) => {
        await tx.envelope.create({
          data: {
            id: envelopeId,
            tenantId: user.tenantId,
            ownerId: user.id,
            title: input.title ?? titleFromFilename(originalFilename),
            originalFileUrl: key,
            originalFilename,
            pageCount: pdf.pageCount,
            originalHash: pdf.sha256,
          },
        });
        await tx.documentVersion.create({
          data: {
            envelopeId,
            versionNumber: 0,
            fileUrl: key,
            hash: pdf.sha256,
            pageCount: pdf.pageCount,
            sizeBytes: pdf.bytes.length,
          },
        });
        await this.audit.record(tx, {
          envelopeId,
          action: 'ENVELOPE_CREATED',
          actorUserId: user.id,
          ipAddress: client.ip,
          userAgent: client.userAgent,
          metadata: {
            versionNumber: 0,
            sha256: pdf.sha256,
            pageCount: pdf.pageCount,
            sizeBytes: pdf.bytes.length,
            sanitized: pdf.sanitized,
            removedActiveContent: pdf.removed,
            upload: { sha256: pdf.original.sha256, sizeBytes: pdf.original.sizeBytes },
            malwareScan: pdf.scanEngine,
          },
        });
      });
    } catch (error) {
      this.logger.error(
        { err: error, envelopeId, key },
        'Envelope could not be saved; removing the stored file',
      );
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }

    this.logger.info(
      {
        envelopeId,
        pageCount: pdf.pageCount,
        sizeBytes: pdf.bytes.length,
        sha256: pdf.sha256,
        sanitized: pdf.sanitized,
        durationMs: Math.round(performance.now() - started),
      },
      'Envelope created',
    );
    return this.get(envelopeId);
  }

  /**
   * One page of a dashboard view (docs/16 step 14). Needs attention is ranked
   * in SQL; every other view is newest first, with an opaque cursor.
   */
  async list(query: ListEnvelopesQuery, tenantId: string): Promise<EnvelopeListResponse> {
    if (query.view === 'attention') return this.listAttention(query, tenantId);

    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows: WithProgressRecipients[] = await this.db.envelope.findMany({
      where: {
        AND: [
          viewWhere(query.view, query.status),
          cursor
            ? {
                // The plain <= bound gives the planner an index range scan on
                // (tenantId, [status,] createdAt desc, id desc) directly; the
                // OR below is what actually excludes the boundary row itself.
                createdAt: { lte: cursor.createdAt },
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {},
        ],
      },
      select: { ...LIST_FIELDS, recipients: { select: PROGRESS_FIELDS } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((envelope) => toSummary(envelope, envelope.recipients)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * Needs attention: ranked by what to chase first, longest-waiting first
   * within each rank, paged on (rank, since, id). The cursor carries the time
   * the first page was evaluated at, so no row moves between pages.
   */
  private async listAttention(
    query: ListEnvelopesQuery,
    tenantId: string,
  ): Promise<EnvelopeListResponse> {
    const after = query.cursor ? decodeAttentionCursor(query.cursor) : undefined;
    const now = after?.at ?? new Date();
    const rows = await this.db.$queryRaw<{ id: string; rank: number; since: Date }[]>(
      attentionPageQuery(tenantId, now, query.limit + 1, query.status, after),
    );
    const page = rows.slice(0, query.limit);
    // Through the tenant filter as well, so a row can only ever be this tenant's.
    const envelopes: WithProgressRecipients[] = await this.db.envelope.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      select: { ...LIST_FIELDS, recipients: { select: PROGRESS_FIELDS } },
    });
    const byId = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    const last = page.at(-1);
    return {
      items: page.flatMap((row) => {
        const envelope = byId.get(row.id);
        if (!envelope) return [];
        return [
          {
            ...toSummary(envelope, envelope.recipients),
            attention: { reason: attentionReason(row.rank), since: row.since.toISOString() },
          },
        ];
      }),
      nextCursor:
        rows.length > query.limit && last
          ? encodeAttentionCursor({ at: now, rank: last.rank, since: last.since, id: last.id })
          : null,
    };
  }

  /**
   * Every dashboard tab's count. Plain status counts (waiting/completed/
   * cancelled/drafts/all) read TenantEnvelopeCount, a handful of
   * primary-key lookups kept exact by a trigger on Envelope regardless of
   * tenant size. Only Needs-attention still costs a scan, and only of the
   * tenant's open work (100M-row scale follow-up, docs/16 step 14).
   */
  async counts(tenantId: string): Promise<EnvelopeCounts> {
    // tenantEnvelopeCount is not one of the tenant-scoped models the Prisma
    // extension filters automatically, so the tenantId is always explicit.
    const [statusRows, [attentionRow]] = await Promise.all([
      this.db.tenantEnvelopeCount.findMany({
        where: { tenantId },
        select: { status: true, count: true },
      }),
      this.db.$queryRaw<{ attention: number }[]>(attentionCountQuery(tenantId, new Date())),
    ]);
    const countOf = new Map(statusRows.map((row) => [row.status, row.count]));
    const get = (status: (typeof statusRows)[number]['status']) => countOf.get(status) ?? 0;
    return {
      attention: attentionRow?.attention ?? 0,
      waiting:
        OPEN_ENVELOPE_STATUSES.reduce((sum, status) => sum + get(status), 0) + get('EXPIRED'),
      completed: get('COMPLETED'),
      cancelled: get('VOIDED') + get('DECLINED'),
      drafts: get('DRAFT'),
      all: statusRows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  async get(id: string): Promise<EnvelopeDetail> {
    // Selected, not included: full rows carry consentText (the whole
    // disclosure text), audit metadata/userAgent JSON and field.value, none
    // of which the response below reads. Run alongside the COMPLETION_SENT
    // lookup instead of after it — the two don't depend on each other
    // (100M-row scale follow-up, docs/16 step 14).
    const [envelope, copies] = await Promise.all([
      this.db.envelope.findUnique({
        where: { id },
        select: {
          ...LIST_FIELDS,
          originalHash: true,
          finalHash: true,
          message: true,
          sequentialSigning: true,
          draftRevision: true,
          reminderIntervalDays: true,
          expiredAt: true,
          voidedAt: true,
          voidReason: true,
          owner: { select: { id: true, fullName: true } },
          voidedBy: { select: { id: true, fullName: true } },
          versions: {
            orderBy: { versionNumber: 'asc' },
            select: {
              versionNumber: true,
              hash: true,
              pageCount: true,
              sizeBytes: true,
              isFinal: true,
              createdByRecipientId: true,
              createdAt: true,
            },
          },
          auditLogs: {
            orderBy: { sequence: 'asc' },
            take: AUDIT_EVENTS_IN_DETAIL,
            select: {
              sequence: true,
              action: true,
              timestamp: true,
              actorUserId: true,
              recipientId: true,
              eventHash: true,
            },
          },
          recipients: {
            orderBy: [{ routingOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              status: true,
              routingOrder: true,
              colorIndex: true,
              invitedAt: true,
              notifiedAt: true,
              lastRemindedAt: true,
              viewedAt: true,
              signedAt: true,
              declinedAt: true,
              declinedReason: true,
              moreTimeRequestedAt: true,
            },
          },
          fields: {
            orderBy: [{ pageNumber: 'asc' }, { ratioY: 'asc' }, { ratioX: 'asc' }],
            select: {
              id: true,
              recipientId: true,
              type: true,
              pageNumber: true,
              required: true,
              ratioX: true,
              ratioY: true,
              ratioWidth: true,
              ratioHeight: true,
            },
          },
        },
      }),
      // The detail's event list is capped, and these come last regardless.
      this.db.auditTrail.findMany({
        where: { envelopeId: id, action: 'COMPLETION_SENT' },
        select: { recipientId: true, timestamp: true },
      }),
    ]);
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

    const copySentAt = (recipientId: string | null) =>
      copies.find((copy) => copy.recipientId === recipientId)?.timestamp.toISOString() ?? null;

    return {
      ...toSummary(envelope, envelope.recipients),
      originalHash: envelope.originalHash,
      finalHash: envelope.finalHash,
      completedAt: envelope.completedAt?.toISOString() ?? null,
      senderCopySentAt: copySentAt(null),
      owner: envelope.owner,
      message: envelope.message,
      sequentialSigning: envelope.sequentialSigning,
      draftRevision: envelope.draftRevision,
      sentAt: envelope.sentAt?.toISOString() ?? null,
      expiresAt: envelope.expiresAt?.toISOString() ?? null,
      reminderIntervalDays: envelope.reminderIntervalDays,
      expiredAt: envelope.expiredAt?.toISOString() ?? null,
      voidedAt: envelope.voidedAt?.toISOString() ?? null,
      voidReason: envelope.voidReason,
      voidedBy: envelope.voidedBy,
      recipients: envelope.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        status: recipient.status,
        routingOrder: recipient.routingOrder,
        colorIndex: recipient.colorIndex,
        invitedAt: recipient.invitedAt?.toISOString() ?? null,
        notifiedAt: recipient.notifiedAt?.toISOString() ?? null,
        lastRemindedAt: recipient.lastRemindedAt?.toISOString() ?? null,
        viewedAt: recipient.viewedAt?.toISOString() ?? null,
        signedAt: recipient.signedAt?.toISOString() ?? null,
        declinedAt: recipient.declinedAt?.toISOString() ?? null,
        declinedReason: recipient.declinedReason,
        copySentAt: copySentAt(recipient.id),
        moreTimeRequestedAt: recipient.moreTimeRequestedAt?.toISOString() ?? null,
      })),
      // Ordered by page, then down the page: the same order the builder walks
      // fields in, so "next field" means the same thing on both sides.
      fields: envelope.fields.map((field) => ({
        id: field.id,
        recipientId: field.recipientId,
        type: field.type,
        pageNumber: field.pageNumber,
        required: field.required,
        ratioX: field.ratioX,
        ratioY: field.ratioY,
        ratioWidth: field.ratioWidth,
        ratioHeight: field.ratioHeight,
      })),
      versions: envelope.versions.map((version) => ({
        versionNumber: version.versionNumber,
        sha256: version.hash,
        pageCount: version.pageCount,
        sizeBytes: version.sizeBytes,
        isFinal: version.isFinal,
        createdByRecipientId: version.createdByRecipientId,
        createdAt: version.createdAt.toISOString(),
      })),
      auditTrail: envelope.auditLogs.map((event) => ({
        sequence: event.sequence,
        action: event.action,
        timestamp: event.timestamp.toISOString(),
        actorUserId: event.actorUserId,
        recipientId: event.recipientId,
        eventHash: event.eventHash,
      })),
    };
  }

  /** Streams one version of the document from storage. */
  async openDocument(id: string, versionNumber: number): Promise<OpenedDocument> {
    const envelope = await this.db.envelope.findUnique({
      where: { id },
      select: {
        originalFilename: true,
        versions: {
          where: { versionNumber },
          select: {
            fileUrl: true,
            hash: true,
            sizeBytes: true,
            isFinal: true,
            storageVersionId: true,
          },
        },
      },
    });
    const version = envelope?.versions[0];
    if (!envelope || !version) throw new AppException('NOT_FOUND', 'Document not found.');

    // The sealed file is read by the version id recorded when it was locked (ADR 0007).
    const object =
      version.isFinal && version.storageVersionId
        ? await this.storage.getSealed(version.fileUrl, version.storageVersionId)
        : await this.storage.get(version.fileUrl);
    this.logger.info(
      { envelopeId: id, versionNumber, sizeBytes: version.sizeBytes, sealed: version.isFinal },
      'Document opened',
    );
    return {
      body: object.body,
      sizeBytes: version.sizeBytes,
      sha256: version.hash,
      filename: envelope.originalFilename,
    };
  }
}
