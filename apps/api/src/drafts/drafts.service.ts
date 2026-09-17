import {
  type AddRecipientInput,
  canOwnFields,
  type FieldInfo,
  MAX_RECIPIENTS_PER_ENVELOPE,
  type RecipientInfo,
  type RecipientResponse,
  type SaveFieldsInput,
  type SaveFieldsResponse,
  type UpdateEnvelopeInput,
  type UpdateRecipientInput,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import type { DocumentField, Prisma, Recipient } from '../generated/prisma/client';
import { maskEmail } from '../logging/redact';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { assertValidGeometry, layoutHash } from './draft-validation';

/** The transaction type the tenant-scoped client hands to a callback. */
type Tx = Parameters<Parameters<TenantPrismaService['client']['$transaction']>[0]>[0];

function toRecipientInfo(row: Recipient): RecipientInfo {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    routingOrder: row.routingOrder,
    colorIndex: row.colorIndex,
  };
}

function toFieldInfo(row: DocumentField): FieldInfo {
  return {
    id: row.id,
    recipientId: row.recipientId,
    type: row.type,
    pageNumber: row.pageNumber,
    required: row.required,
    ratioX: row.ratioX,
    ratioY: row.ratioY,
    ratioWidth: row.ratioWidth,
    ratioHeight: row.ratioHeight,
  };
}

/**
 * Editing a draft: its settings, the people on it, and where they sign.
 *
 * Every change goes through `lockDraft` first, which in one statement takes the
 * envelope's row lock, checks the tenant, checks the envelope is still a draft,
 * checks the caller's revision and bumps it. Nothing else in this service has to
 * repeat those checks.
 */
@Injectable()
export class DraftsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(DraftsService.name) private readonly logger: PinoLogger,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /**
   * Claims the draft for this change and returns its new revision.
   *
   * `updateMany` rather than `update`: it is the tenant-scoped form, and a
   * conditional update that matches no row tells us to look at why, instead of
   * throwing a Prisma error we would have to interpret.
   */
  private async lockDraft(tx: Tx, envelopeId: string, ifMatch?: number): Promise<number> {
    const claimed = await tx.envelope.updateMany({
      where: {
        id: envelopeId,
        status: 'DRAFT',
        ...(ifMatch === undefined ? {} : { draftRevision: ifMatch }),
      },
      data: { draftRevision: { increment: 1 } },
    });

    if (claimed.count === 0) await this.explainFailedLock(tx, envelopeId);

    const envelope = await tx.envelope.findUnique({
      where: { id: envelopeId },
      select: { draftRevision: true },
    });
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
    return envelope.draftRevision;
  }

  /** Works out which of the three reasons the conditional update matched nothing. */
  private async explainFailedLock(tx: Tx, envelopeId: string): Promise<never> {
    const envelope = await tx.envelope.findUnique({
      where: { id: envelopeId },
      select: { status: true, draftRevision: true },
    });

    // Another tenant's id, and an id that does not exist, look identical.
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');

    if (envelope.status !== 'DRAFT') {
      throw new AppException(
        'ENVELOPE_NOT_DRAFT',
        'This envelope has been sent and can no longer be edited.',
      );
    }

    throw new AppException(
      'DRAFT_REVISION_MISMATCH',
      'Someone else changed this document. Reload to see their changes.',
      { headers: { ETag: `"${envelope.draftRevision}"` } },
    );
  }

  private async requireDraft(envelopeId: string) {
    const envelope = await this.db.envelope.findUnique({
      where: { id: envelopeId },
      select: { id: true, status: true, pageCount: true, draftRevision: true },
    });
    if (!envelope) throw new AppException('NOT_FOUND', 'Envelope not found.');
    return envelope;
  }

  async updateEnvelope(
    envelopeId: string,
    input: UpdateEnvelopeInput,
    user: AuthenticatedUser,
    client: ClientInfo,
    ifMatch?: number,
  ): Promise<{ draftRevision: number }> {
    const started = performance.now();

    const draftRevision = await this.db.$transaction(async (tx) => {
      const revision = await this.lockDraft(tx, envelopeId, ifMatch);
      await tx.envelope.updateMany({
        where: { id: envelopeId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.message === undefined ? {} : { message: input.message }),
          ...(input.sequentialSigning === undefined
            ? {}
            : { sequentialSigning: input.sequentialSigning }),
        },
      });
      await this.audit.record(tx, {
        envelopeId,
        action: 'ENVELOPE_UPDATED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        // The values themselves are not recorded: a title or a message can hold
        // patient data, and the audit trail cannot be edited afterwards.
        metadata: { changed: Object.keys(input).sort(), draftRevision: revision },
      });
      return revision;
    });

    this.logger.info(
      {
        envelopeId,
        changed: Object.keys(input).sort(),
        draftRevision,
        durationMs: Math.round(performance.now() - started),
      },
      'Draft settings updated',
    );
    return { draftRevision };
  }

  async addRecipient(
    envelopeId: string,
    input: AddRecipientInput,
    user: AuthenticatedUser,
    client: ClientInfo,
    ifMatch?: number,
  ): Promise<RecipientResponse> {
    const started = performance.now();

    const result = await this.db.$transaction(async (tx) => {
      const draftRevision = await this.lockDraft(tx, envelopeId, ifMatch);

      const existing = await tx.recipient.findMany({
        where: { envelopeId },
        select: { email: true, colorIndex: true, routingOrder: true },
      });

      if (existing.length >= MAX_RECIPIENTS_PER_ENVELOPE) {
        throw new AppException(
          'VALIDATION_FAILED',
          `An envelope can have at most ${MAX_RECIPIENTS_PER_ENVELOPE} people.`,
        );
      }
      if (existing.some((r) => r.email === input.email)) {
        throw new AppException('RECIPIENT_EMAIL_TAKEN', 'That person is already on this envelope.');
      }

      const recipient = await tx.recipient.create({
        data: {
          envelopeId,
          name: input.name,
          email: input.email,
          role: input.role,
          routingOrder:
            input.routingOrder ?? Math.max(0, ...existing.map((r) => r.routingOrder)) + 1,
          colorIndex: lowestUnusedColor(existing.map((r) => r.colorIndex)),
        },
      });

      await this.audit.record(tx, {
        envelopeId,
        action: 'RECIPIENT_ADDED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        // Name and email stay out of the immutable trail; the recipient row
        // holds them and can still be corrected or erased.
        metadata: {
          recipientId: recipient.id,
          role: recipient.role,
          routingOrder: recipient.routingOrder,
          draftRevision,
        },
      });

      return { draftRevision, recipient };
    });

    this.logger.info(
      {
        envelopeId,
        recipientId: result.recipient.id,
        role: result.recipient.role,
        email: maskEmail(input.email),
        durationMs: Math.round(performance.now() - started),
      },
      'Recipient added',
    );
    return { draftRevision: result.draftRevision, recipient: toRecipientInfo(result.recipient) };
  }

  async updateRecipient(
    envelopeId: string,
    recipientId: string,
    input: UpdateRecipientInput,
    user: AuthenticatedUser,
    client: ClientInfo,
    ifMatch?: number,
  ): Promise<RecipientResponse> {
    const result = await this.db.$transaction(async (tx) => {
      const draftRevision = await this.lockDraft(tx, envelopeId, ifMatch);

      const [current] = await tx.recipient.findMany({
        where: { id: recipientId, envelopeId },
        take: 1,
      });
      if (!current) throw new AppException('NOT_FOUND', 'Recipient not found.');

      if (input.email && input.email !== current.email) {
        const clash = await tx.recipient.findMany({
          where: { envelopeId, email: input.email },
          select: { id: true },
          take: 1,
        });
        if (clash.length > 0) {
          throw new AppException(
            'RECIPIENT_EMAIL_TAKEN',
            'That person is already on this envelope.',
          );
        }
      }

      // A CC or VIEWER marks nothing, so their fields go with the role change.
      // The client warns first; doing it here keeps the rule in one place.
      const role = input.role ?? current.role;
      let fieldsRemoved = 0;
      if (!canOwnFields(role)) {
        const removed = await tx.documentField.deleteMany({ where: { envelopeId, recipientId } });
        fieldsRemoved = removed.count;
      }

      await tx.recipient.updateMany({
        where: { id: recipientId, envelopeId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.routingOrder === undefined ? {} : { routingOrder: input.routingOrder }),
        },
      });

      const [recipient] = await tx.recipient.findMany({
        where: { id: recipientId, envelopeId },
        take: 1,
      });
      if (!recipient) throw new AppException('NOT_FOUND', 'Recipient not found.');

      await this.audit.record(tx, {
        envelopeId,
        action: 'RECIPIENT_UPDATED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          recipientId,
          changed: Object.keys(input).sort(),
          role: recipient.role,
          routingOrder: recipient.routingOrder,
          fieldsRemoved,
          draftRevision,
        },
      });

      return { draftRevision, recipient, fieldsRemoved };
    });

    this.logger.info(
      {
        envelopeId,
        recipientId,
        changed: Object.keys(input).sort(),
        fieldsRemoved: result.fieldsRemoved,
      },
      'Recipient updated',
    );
    return {
      draftRevision: result.draftRevision,
      recipient: toRecipientInfo(result.recipient),
      fieldsRemoved: result.fieldsRemoved,
    };
  }

  async removeRecipient(
    envelopeId: string,
    recipientId: string,
    user: AuthenticatedUser,
    client: ClientInfo,
    ifMatch?: number,
  ): Promise<{ draftRevision: number }> {
    const draftRevision = await this.db.$transaction(async (tx) => {
      const revision = await this.lockDraft(tx, envelopeId, ifMatch);

      // The fields go too, by the composite foreign key's ON DELETE CASCADE.
      const removed = await tx.recipient.deleteMany({ where: { id: recipientId, envelopeId } });
      if (removed.count === 0) throw new AppException('NOT_FOUND', 'Recipient not found.');

      await this.audit.record(tx, {
        envelopeId,
        action: 'RECIPIENT_REMOVED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: { recipientId, draftRevision: revision },
      });
      return revision;
    });

    this.logger.info({ envelopeId, recipientId }, 'Recipient removed');
    return { draftRevision };
  }

  /**
   * Replaces the whole field layout.
   *
   * The builder always holds the complete layout, so replacing it is simpler and
   * safer than diffing: there is no way to end up with a field the user deleted.
   * Ids come from the client, so a field keeps its identity across saves.
   */
  async saveFields(
    envelopeId: string,
    input: SaveFieldsInput,
    user: AuthenticatedUser,
    client: ClientInfo,
    ifMatch?: number,
  ): Promise<SaveFieldsResponse> {
    const started = performance.now();
    const envelope = await this.requireDraft(envelopeId);
    if (envelope.status !== 'DRAFT') {
      throw new AppException(
        'ENVELOPE_NOT_DRAFT',
        'This envelope has been sent and can no longer be edited.',
      );
    }

    const prepared = input.fields.map((field, index) => ({
      ...field,
      ...assertValidGeometry(field, index, envelope.pageCount),
    }));

    const duplicate = findDuplicateId(prepared.map((f) => f.id));
    if (duplicate) {
      throw new AppException('VALIDATION_FAILED', 'Two fields share an id.', {
        errors: [{ path: 'fields', message: `Duplicate field id ${duplicate}.` }],
      });
    }

    const result = await this.db.$transaction(async (tx) => {
      const recipients = await tx.recipient.findMany({
        where: { envelopeId },
        select: { id: true, role: true },
      });
      const byId = new Map(recipients.map((r) => [r.id, r]));

      prepared.forEach((field, index) => {
        const recipient = byId.get(field.recipientId);
        if (!recipient) {
          throw new AppException(
            'VALIDATION_FAILED',
            'A field belongs to nobody on this envelope.',
            {
              errors: [
                {
                  path: `fields[${index}].recipientId`,
                  message: 'No such person on this envelope.',
                },
              ],
            },
          );
        }
        if (!canOwnFields(recipient.role)) {
          throw new AppException('VALIDATION_FAILED', 'This person does not sign the document.', {
            errors: [
              {
                path: `fields[${index}].recipientId`,
                message: 'A recipient who only views or is copied cannot have fields.',
              },
            ],
          });
        }
      });

      const existing = await tx.documentField.findMany({ where: { envelopeId } });
      const hash = layoutHash(prepared);

      // Nothing moved: autosave fires on every interaction, and an unchanged
      // layout must not add an audit row or bump the revision.
      if (hash === layoutHash(existing.map(toFieldInfo))) {
        return { draftRevision: envelope.draftRevision, fields: existing, unchanged: true };
      }

      const draftRevision = await this.lockDraft(tx, envelopeId, ifMatch);

      await tx.documentField.deleteMany({ where: { envelopeId } });
      if (prepared.length > 0) {
        await tx.documentField.createMany({
          data: prepared.map((field) => ({
            id: field.id,
            envelopeId,
            recipientId: field.recipientId,
            type: field.type,
            pageNumber: field.pageNumber,
            required: field.required,
            ratioX: field.ratioX,
            ratioY: field.ratioY,
            ratioWidth: field.ratioWidth,
            ratioHeight: field.ratioHeight,
          })),
        });
      }

      await this.audit.record(tx, {
        envelopeId,
        action: 'FIELDS_SAVED',
        actorUserId: user.id,
        ipAddress: client.ip,
        userAgent: client.userAgent,
        metadata: {
          layoutHash: hash,
          fieldCount: prepared.length,
          byType: countBy(prepared.map((f) => f.type)),
          pages: [...new Set(prepared.map((f) => f.pageNumber))].sort((a, b) => a - b),
          draftRevision,
        },
      });

      const saved = await tx.documentField.findMany({ where: { envelopeId } });
      return { draftRevision, fields: saved, unchanged: false };
    });

    this.logger.info(
      {
        envelopeId,
        fieldCount: result.fields.length,
        unchanged: result.unchanged,
        draftRevision: result.draftRevision,
        durationMs: Math.round(performance.now() - started),
      },
      result.unchanged ? 'Field layout unchanged; nothing written' : 'Field layout saved',
    );

    return {
      draftRevision: result.draftRevision,
      fields: result.fields.map(toFieldInfo),
    };
  }
}

/** The lowest palette slot nobody is using, so colours stay distinct. */
function lowestUnusedColor(taken: readonly number[]): number {
  const used = new Set(taken);
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}

function findDuplicateId(ids: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

function countBy(values: readonly string[]): Prisma.InputJsonObject {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
