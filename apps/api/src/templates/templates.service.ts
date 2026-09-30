import { randomUUID } from 'node:crypto';
import {
  type CreateFromTemplateInput,
  type CreateTemplateInput,
  checkReadyToSend,
  checkTemplatePeople,
  type DocumentCategory,
  type EnvelopeDetail,
  type EnvelopeMetadata,
  type ListTemplatesQuery,
  TEMPLATE_ROLE_NAME_MAX_LENGTH,
  type TemplateDetail,
  type TemplateListResponse,
  type UpdateTemplateInput,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { assertCanManage, ownerScopeOf } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import { JurisdictionService } from '../compliance/jurisdiction.service';
import { toFieldInfo, toRecipientInfo } from '../drafts/draft-mappers';
import { layoutHash } from '../drafts/draft-validation';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { Prisma } from '../generated/prisma/client';
import { maskEmail } from '../logging/redact';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SendingService } from '../sending/sending.service';
import {
  envelopeDocumentKey,
  StorageService,
  templateDocumentKey,
} from '../storage/storage.service';
import { toTemplateDetail, toTemplateSummary } from './template-mappers';

/** The transaction type the tenant-scoped client hands to a callback. */
export type TemplateTx = Parameters<
  Parameters<TenantPrismaService['client']['$transaction']>[0]
>[0];

/** What a new envelope needs from a request or a bulk row. */
export interface InstantiateInput {
  recipients: CreateFromTemplateInput['recipients'];
  message?: string;
  title?: string;
  externalId?: string;
  metadata?: EnvelopeMetadata;
}

export interface Instantiated {
  envelopeId: string;
  /** What the template asks for when its envelopes are sent. */
  reminderIntervalDays: number | null;
}

function countBy(values: readonly string[]): Prisma.InputJsonObject {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

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
    private readonly jurisdiction: JurisdictionService,
    private readonly audit: AuditService,
    private readonly sending: SendingService,
    private readonly envelopes: EnvelopesService,
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

  /**
   * Creates one envelope from a template: the same steps, in the same order, as
   * `EnvelopesService.create`, because it is envelope creation (ADR 0027).
   * Policy is resolved and the category checked before anything is stored, a
   * fresh snapshot is frozen, and the PDF is a new copy owned by the envelope.
   *
   * `inTransaction` runs inside the creating transaction. Bulk send uses it to
   * record the row's envelope id atomically with the envelope (ADR 0028).
   */
  async instantiate(
    user: AuthenticatedUser,
    templateId: string,
    input: InstantiateInput,
    client: ClientInfo,
    inTransaction?: (tx: TemplateTx, envelopeId: string) => Promise<void>,
  ): Promise<Instantiated> {
    const started = performance.now();
    const template = await this.db.template.findFirst({
      where: { id: templateId },
      include: { roles: true, fields: true },
    });
    if (!template) throw new AppException('TEMPLATE_NOT_FOUND');
    if (template.archivedAt) throw new AppException('TEMPLATE_ARCHIVED');

    const problems = checkTemplatePeople(
      template.roles.map((role) => role.name),
      input.recipients,
    );
    if (problems.length > 0) {
      throw new AppException('TEMPLATE_ROLE_MISMATCH', undefined, {
        errors: problems.map((problem) => ({
          path: 'recipients',
          message:
            problem.code === 'MISSING_ROLE'
              ? `No one was given for the role "${problem.role}".`
              : problem.code === 'UNKNOWN_ROLE'
                ? `The template has no role "${problem.role}".`
                : problem.code === 'DUPLICATE_ROLE'
                  ? `More than one person was given for the role "${problem.role}".`
                  : 'The same email address is used for more than one role.',
        })),
      });
    }

    // Resolved and checked before anything is stored, and never inherited
    // from the template: a category blocked since it was saved is refused.
    const policy = await this.jurisdiction.resolveForTenant(user.tenantId, undefined);
    this.jurisdiction.assertCategoryAllowed(policy, template.documentCategory as DocumentCategory);

    const envelopeId = randomUUID();
    const key = envelopeDocumentKey(user.tenantId, envelopeId, 0, randomUUID());
    await this.storage.copy(template.originalFileUrl, key);

    const people = new Map(input.recipients.map((person) => [person.role, person]));
    const recipients = template.roles.map((role) => {
      const person = people.get(role.name) as (typeof input.recipients)[number];
      return { id: randomUUID(), role, person };
    });
    const recipientIdFor = new Map(recipients.map((r) => [r.role.id, r.id]));
    const fields = template.fields.map((field) => ({
      id: randomUUID(),
      recipientId: recipientIdFor.get(field.templateRoleId) as string,
      type: field.type,
      pageNumber: field.pageNumber,
      required: field.required,
      ratioX: field.ratioX,
      ratioY: field.ratioY,
      ratioWidth: field.ratioWidth,
      ratioHeight: field.ratioHeight,
    }));

    try {
      await this.db.$transaction(async (tx) => {
        await tx.envelope.create({
          data: {
            id: envelopeId,
            tenantId: user.tenantId,
            ownerId: user.id,
            title: input.title ?? template.name,
            originalFileUrl: key,
            originalFilename: template.originalFilename,
            pageCount: template.pageCount,
            originalHash: template.originalHash,
            documentCategory: template.documentCategory,
            message: input.message ?? template.defaultMessage,
            sequentialSigning: template.sequentialSigning,
            reminderIntervalDays: template.reminderIntervalDays,
            externalId: input.externalId,
            ...(input.metadata ? { metadata: input.metadata } : {}),
            jurisdictionCode: policy.code,
            policySnapshot: policy as unknown as Prisma.InputJsonObject,
            policyVersion: policy.version,
          },
        });
        await tx.documentVersion.create({
          data: {
            envelopeId,
            versionNumber: 0,
            fileUrl: key,
            hash: template.originalHash,
            pageCount: template.pageCount,
            sizeBytes: template.originalSizeBytes,
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
            sha256: template.originalHash,
            pageCount: template.pageCount,
            sizeBytes: template.originalSizeBytes,
            templateId: template.id,
            documentCategory: template.documentCategory,
            jurisdictionCode: policy.code,
            policyVersion: policy.version,
          },
        });
        await tx.recipient.createMany({
          data: recipients.map(({ id, role, person }) => ({
            id,
            envelopeId,
            name: person.name,
            email: person.email,
            role: role.role,
            routingOrder: role.routingOrder,
            colorIndex: role.colorIndex,
          })),
        });
        for (const { id, role } of recipients) {
          await this.audit.record(tx, {
            envelopeId,
            action: 'RECIPIENT_ADDED',
            actorUserId: user.id,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            // Name and email stay out of the immutable trail, as when a person is added by hand.
            metadata: {
              recipientId: id,
              role: role.role,
              routingOrder: role.routingOrder,
              templateRoleId: role.id,
            },
          });
        }
        if (fields.length > 0) {
          await tx.documentField.createMany({ data: fields.map((f) => ({ ...f, envelopeId })) });
          await this.audit.record(tx, {
            envelopeId,
            action: 'FIELDS_SAVED',
            actorUserId: user.id,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            metadata: {
              layoutHash: layoutHash(fields),
              fieldCount: fields.length,
              byType: countBy(fields.map((f) => f.type)),
              pages: [...new Set(fields.map((f) => f.pageNumber))].sort((a, b) => a - b),
              templateId: template.id,
            },
          });
        }
        await inTransaction?.(tx, envelopeId);
      });
    } catch (error) {
      this.logger.error(
        { err: error, envelopeId, templateId, key },
        'Envelope from template could not be saved; removing the stored file',
      );
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }

    this.logger.info(
      {
        envelopeId,
        templateId,
        tenantId: user.tenantId,
        userId: user.id,
        recipientCount: recipients.length,
        fieldCount: fields.length,
        recipients: recipients.map((r) => maskEmail(r.person.email)),
        durationMs: Math.round(performance.now() - started),
      },
      'Envelope created from template',
    );
    return { envelopeId, reminderIntervalDays: template.reminderIntervalDays };
  }

  /** POST /templates/:id/envelopes: create one envelope, and send it if asked. */
  async createEnvelope(
    user: AuthenticatedUser,
    templateId: string,
    input: CreateFromTemplateInput,
    client: ClientInfo,
  ): Promise<{ envelopeId: string; detail: () => Promise<EnvelopeDetail> }> {
    const { envelopeId, reminderIntervalDays } = await this.instantiate(
      user,
      templateId,
      input,
      client,
    );
    if (input.send) {
      await this.sending.send(
        envelopeId,
        reminderIntervalDays === null ? {} : { reminderIntervalDays },
        user,
        client,
      );
    }
    return {
      envelopeId,
      detail: () => this.envelopes.get(envelopeId, ownerScopeOf(user)),
    };
  }

  /** The detail of an envelope this caller may see; what a replayed create answers with. */
  envelopeDetail(envelopeId: string, user: AuthenticatedUser): Promise<EnvelopeDetail> {
    return this.envelopes.get(envelopeId, ownerScopeOf(user));
  }
}
