import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from './prisma.service';

/** Operations whose `where` gets the tenant filter added. */
const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

export class TenantContextMissingError extends Error {
  constructor(operation: string) {
    super(`Tenant-scoped query "${operation}" ran outside an authenticated request`);
    this.name = 'TenantContextMissingError';
  }
}

export class CrossTenantWriteError extends Error {
  constructor() {
    super('Attempted to write a row for another tenant');
    this.name = 'CrossTenantWriteError';
  }
}

function tenantOf(cls: ClsService<RequestContext>, operation: string): string {
  const tenantId = cls.isActive() ? cls.get('tenantId') : undefined;
  if (!tenantId) throw new TenantContextMissingError(operation);
  return tenantId;
}

function scopeArgs(args: Record<string, unknown>, operation: string, tenantId: string) {
  if (FILTERED_OPERATIONS.has(operation)) {
    return { ...args, where: { ...((args.where as object | undefined) ?? {}), tenantId } };
  }
  if (CREATE_OPERATIONS.has(operation)) {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    for (const row of rows as { tenantId?: unknown }[]) {
      if (row.tenantId !== tenantId) throw new CrossTenantWriteError();
    }
    return args;
  }
  // upsert and anything unknown would bypass the filter: refuse them.
  throw new Error(`Operation "${operation}" is not supported on tenant-scoped models`);
}

/**
 * Child models have no tenantId of their own, so they are filtered through their
 * envelope instead. Only the plural operations are allowed: `findUnique`,
 * `update` and `delete` take a unique `where` that a relation filter cannot
 * safely extend, and letting them through unscoped is how one tenant would end
 * up editing another's rows.
 */
const CHILD_FILTERED_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);

/** The relation a child model reaches its tenant through. */
type ScopeParent = 'envelope' | 'template' | 'batch';

function scopeChildArgs(
  args: Record<string, unknown>,
  operation: string,
  tenantId: string,
  parent: ScopeParent = 'envelope',
) {
  if (CHILD_FILTERED_OPERATIONS.has(operation)) {
    return {
      ...args,
      where: { ...((args.where as object | undefined) ?? {}), [parent]: { tenantId } },
    };
  }
  if (CREATE_OPERATIONS.has(operation)) {
    // A child row's parent id is always checked against a parent that was
    // itself loaded or locked through this client, so the create is already
    // confined to the tenant.
    return args;
  }
  throw new Error(
    `Operation "${operation}" is not supported on ${parent}-scoped models; ` +
      `use the findMany/updateMany/deleteMany form with a ${parent} id filter`,
  );
}

/**
 * Database access for tenant-owned data (docs/05, "Multi-Tenancy"). Every query on
 * a tenant-owned root model is limited to the signed-in user's tenant, taken from
 * the request context. Queries outside an authenticated request fail instead of
 * silently returning every tenant's rows.
 *
 * Recipients and fields are queried directly by the draft editor, so they carry
 * their own filter through their envelope. Versions and audit events are only
 * ever reached through an envelope that is already filtered.
 */
@Injectable()
export class TenantPrismaService {
  readonly client;

  constructor(prisma: PrismaService, cls: ClsService<RequestContext>) {
    this.client = prisma.$extends({
      name: 'tenant-scope',
      query: {
        envelope: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeArgs(args as Record<string, unknown>, operation, tenantId) as typeof args,
            );
          },
        },
        recipient: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeChildArgs(args as Record<string, unknown>, operation, tenantId) as typeof args,
            );
          },
        },
        documentField: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeChildArgs(args as Record<string, unknown>, operation, tenantId) as typeof args,
            );
          },
        },
        // Templates and bulk batches (docs/20, ADR 0027, ADR 0028). The roots
        // carry tenantId; their rows are filtered through the parent.
        template: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeArgs(args as Record<string, unknown>, operation, tenantId) as typeof args,
            );
          },
        },
        templateRole: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeChildArgs(
                args as Record<string, unknown>,
                operation,
                tenantId,
                'template',
              ) as typeof args,
            );
          },
        },
        templateField: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeChildArgs(
                args as Record<string, unknown>,
                operation,
                tenantId,
                'template',
              ) as typeof args,
            );
          },
        },
        bulkBatch: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeArgs(args as Record<string, unknown>, operation, tenantId) as typeof args,
            );
          },
        },
        bulkBatchRow: {
          $allOperations({ operation, args, query }) {
            const tenantId = tenantOf(cls, operation);
            return query(
              scopeChildArgs(
                args as Record<string, unknown>,
                operation,
                tenantId,
                'batch',
              ) as typeof args,
            );
          },
        },
      },
    });
  }
}
