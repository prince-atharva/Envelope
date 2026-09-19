import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type {
  CreateEnvelopeInput,
  EnvelopeDetail,
  EnvelopeListResponse,
  EnvelopeSummary,
  ListEnvelopesQuery,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import type { Envelope } from '../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { envelopeDocumentKey, StorageService } from '../storage/storage.service';
import { PdfValidatorService } from '../uploads/pdf-validator.service';

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

function toSummary(envelope: Envelope): EnvelopeSummary {
  return {
    id: envelope.id,
    title: envelope.title,
    status: envelope.status,
    originalFilename: envelope.originalFilename,
    pageCount: envelope.pageCount,
    createdAt: envelope.createdAt.toISOString(),
    updatedAt: envelope.updatedAt.toISOString(),
  };
}

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

  /** Newest first, with an opaque cursor for the next page. */
  async list(query: ListEnvelopesQuery): Promise<EnvelopeListResponse> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.db.envelope.findMany({
      where: cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toSummary),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(id: string): Promise<EnvelopeDetail> {
    const envelope = await this.db.envelope.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, fullName: true } },
        voidedBy: { select: { id: true, fullName: true } },
        versions: { orderBy: { versionNumber: 'asc' } },
        auditLogs: { orderBy: { sequence: 'asc' }, take: AUDIT_EVENTS_IN_DETAIL },
        recipients: { orderBy: [{ routingOrder: 'asc' }, { createdAt: 'asc' }] },
        fields: { orderBy: [{ pageNumber: 'asc' }, { ratioY: 'asc' }, { ratioX: 'asc' }] },
      },
    });
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

    // Read on their own: the detail's event list is capped, and these come last.
    const copies = await this.db.auditTrail.findMany({
      where: { envelopeId: id, action: 'COMPLETION_SENT' },
      select: { recipientId: true, timestamp: true },
    });
    const copySentAt = (recipientId: string | null) =>
      copies.find((copy) => copy.recipientId === recipientId)?.timestamp.toISOString() ?? null;

    return {
      ...toSummary(envelope),
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
