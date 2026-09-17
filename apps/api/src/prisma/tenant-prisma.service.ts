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
 * Database access for tenant-owned data (docs/05, "Multi-Tenancy"). Every query on
 * a tenant-owned root model is limited to the signed-in user's tenant, taken from
 * the request context. Queries outside an authenticated request fail instead of
 * silently returning every tenant's rows.
 *
 * Child rows (versions, recipients, fields, audit events) are reached through
 * their envelope, which is itself filtered.
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
      },
    });
  }
}
