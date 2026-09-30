import { randomUUID } from 'node:crypto';
import {
  type CreateTemplateInput,
  checkReadyToSend,
  type ListTemplatesQuery,
  TEMPLATE_ROLE_NAME_MAX_LENGTH,
  type TemplateDetail,
  type TemplateListResponse,
  type UpdateTemplateInput,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertCanManage } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import { toFieldInfo, toRecipientInfo } from '../drafts/draft-mappers';
import { Prisma } from '../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService, templateDocumentKey } from '../storage/storage.service';
import { toTemplateDetail, toTemplateSummary } from './template-mappers';

const SUMMARY_INCLUDE = {
  createdBy: { select: { fullName: true } },
  _count: { select: { roles: true, fields: true } },
} satisfies Prisma.TemplateInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  roles: true,
  fields: { orderBy: [{ pageNumber: 'asc' }, { ratioY: 'asc' }, { ratioX: 'asc' }] },
} satisfies Prisma.TemplateInclude;

/** The most templates one listing returns; a workspace is not expected to keep more active ones. */
const MAX_LISTED = 500;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Reusable documents (docs/20, ADR 0027). A template is its own copy of the
 * PDF plus role slots and the fields that belong to them. Policy is never kept
 * here: every envelope made from a template freezes a fresh snapshot.
 *
 * Template create, rename and archive are structured logs rather than audit
 * rows, because the audit trail belongs to an envelope (ADR 0004).
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    @InjectPinoLogger(TemplatesService.name) private readonly logger: PinoLogger,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /** Saves an envelope the caller can manage as a template: its PDF, its people as roles, its fields. */
  async create(user: AuthenticatedUser, input: CreateTemplateInput): Promise<TemplateDetail> {
    const started = performance.now();
    const envelope = await this.db.envelope.findFirst({
      where: { id: input.envelopeId },
      include: {
        recipients: true,
        fields: true,
        versions: { where: { versionNumber: 0 }, take: 1 },
      },
    });
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
    assertCanManage(envelope.ownerId, user);
    if (envelope.purgedAt) throw new AppException('ENVELOPE_PURGED');
    const original = envelope.versions[0];
    if (!original) throw new Error(`Envelope ${envelope.id} has no version 0`);

    const issues = checkReadyToSend({
      recipients: envelope.recipients.map(toRecipientInfo),
      fields: envelope.fields.map(toFieldInfo),
    });
    if (issues.length > 0) {
      throw new AppException(
        'NOT_READY_TO_SEND',
        'This envelope cannot be saved as a template yet.',
        {
          errors: issues.map((issue) => ({ path: 'envelope', message: issue.message })),
        },
      );
    }

    const known = new Set(envelope.recipients.map((r) => r.id));
    for (const recipientId of Object.keys(input.roleNames ?? {})) {
      if (!known.has(recipientId)) {
        throw new AppException(
          'VALIDATION_FAILED',
          'roleNames names someone who is not on this envelope.',
          {
            errors: [
              { path: `roleNames.${recipientId}`, message: 'Not a recipient of this envelope' },
            ],
          },
        );
      }
    }
    const roleNameFor = new Map<string, string>();
    const taken = new Set<string>();
    for (const recipient of envelope.recipients) {
      const wanted = (input.roleNames?.[recipient.id] ?? recipient.name).slice(
        0,
        TEMPLATE_ROLE_NAME_MAX_LENGTH - 4,
      );
      let name = wanted;
      for (let n = 2; taken.has(name); n += 1) name = `${wanted} (${n})`;
      taken.add(name);
      roleNameFor.set(recipient.id, name);
    }
    if (input.roleNames) {
      const given = Object.values(input.roleNames);
      if (new Set(given).size !== given.length) {
        throw new AppException('VALIDATION_FAILED', 'Each role needs a different name.', {
          errors: [{ path: 'roleNames', message: 'Role names must be different' }],
        });
      }
    }

    const templateId = randomUUID();
    const key = templateDocumentKey(user.tenantId, templateId, randomUUID());
    await this.storage.copy(envelope.originalFileUrl, key);

    const roleIdFor = new Map(envelope.recipients.map((r) => [r.id, randomUUID()]));
    try {
      await this.db.$transaction(async (tx) => {
        const clash = await tx.template.findFirst({
          where: { name: input.name, archivedAt: null },
          select: { id: true },
        });
        if (clash) throw new AppException('TEMPLATE_NAME_TAKEN');
        await tx.template.create({
          data: {
            id: templateId,
            tenantId: user.tenantId,
            name: input.name,
            description: input.description,
            originalFileUrl: key,
            originalFilename: envelope.originalFilename,
            originalHash: original.hash,
            originalSizeBytes: original.sizeBytes,
            pageCount: envelope.pageCount,
            documentCategory: envelope.documentCategory,
            defaultMessage: envelope.message,
            sequentialSigning: envelope.sequentialSigning,
            reminderIntervalDays: envelope.reminderIntervalDays,
            createdById: user.id,
            roles: {
              create: envelope.recipients.map((recipient) => ({
                id: roleIdFor.get(recipient.id) as string,
                name: roleNameFor.get(recipient.id) as string,
                role: recipient.role,
                routingOrder: recipient.routingOrder,
                colorIndex: recipient.colorIndex,
              })),
            },
          },
        });
        await tx.templateField.createMany({
          data: envelope.fields.map((field) => ({
            templateId,
            templateRoleId: roleIdFor.get(field.recipientId) as string,
            type: field.type,
            pageNumber: field.pageNumber,
            required: field.required,
            ratioX: field.ratioX,
            ratioY: field.ratioY,
            ratioWidth: field.ratioWidth,
            ratioHeight: field.ratioHeight,
          })),
        });
      });
    } catch (error) {
      this.logger.error(
        { err: error, templateId, sourceEnvelopeId: envelope.id, key },
        'Template could not be saved; removing the stored copy',
      );
      await this.storage.delete(key).catch(() => undefined);
      if (isUniqueViolation(error)) throw new AppException('TEMPLATE_NAME_TAKEN');
      throw error;
    }

    this.logger.info(
      {
        templateId,
        tenantId: user.tenantId,
        userId: user.id,
        sourceEnvelopeId: envelope.id,
        roleCount: envelope.recipients.length,
        fieldCount: envelope.fields.length,
        durationMs: Math.round(performance.now() - started),
      },
      'Template created',
    );
    return this.get(templateId);
  }

  async list(user: AuthenticatedUser, query: ListTemplatesQuery): Promise<TemplateListResponse> {
    if (query.archived && user.role === 'MEMBER') {
      throw new AppException('FORBIDDEN_ROLE', 'Only an admin can list archived templates.');
    }
    const rows = await this.db.template.findMany({
      where: { archivedAt: query.archived ? { not: null } : null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LISTED,
      include: SUMMARY_INCLUDE,
    });
    return { templates: rows.map(toTemplateSummary) };
  }

  /** An archived template can still be read, so a batch that used it can name it. */
  async get(id: string): Promise<TemplateDetail> {
    const row = await this.db.template.findFirst({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw new AppException('TEMPLATE_NOT_FOUND');
    return toTemplateDetail(row);
  }

  async update(
    id: string,
    input: UpdateTemplateInput,
    user: AuthenticatedUser,
  ): Promise<TemplateDetail> {
    const existing = await this.db.template.findFirst({
      where: { id },
      select: { archivedAt: true },
    });
    if (!existing) throw new AppException('TEMPLATE_NOT_FOUND');

    const archivedAt =
      input.archived === undefined
        ? undefined
        : input.archived
          ? (existing.archivedAt ?? new Date())
          : null;
    try {
      await this.db.template.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          defaultMessage: input.defaultMessage,
          archivedAt,
        },
      });
    } catch (error) {
      // Renaming onto, or restoring next to, an active template of the same name.
      if (isUniqueViolation(error)) throw new AppException('TEMPLATE_NAME_TAKEN');
      throw error;
    }

    const changed = Object.keys(input);
    this.logger.info(
      { templateId: id, tenantId: user.tenantId, userId: user.id, changed },
      input.archived === true && existing.archivedAt === null
        ? 'Template archived'
        : input.archived === false && existing.archivedAt !== null
          ? 'Template restored'
          : input.name !== undefined
            ? 'Template renamed'
            : 'Template updated',
    );
    return this.get(id);
  }
}
