import type {
  TemplateDetail,
  TemplateFieldInfo,
  TemplateRoleInfo,
  TemplateSummary,
} from '@envelope/shared';
import type { Template, TemplateField, TemplateRole } from '../generated/prisma/client';

/** Database rows to the shapes the API returns. */

type WithCounts = Template & {
  createdBy: { fullName: string };
  _count: { roles: number; fields: number };
};

export function toTemplateSummary(row: WithCounts): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    pageCount: row.pageCount,
    documentCategory: row.documentCategory,
    roleCount: row._count.roles,
    fieldCount: row._count.fields,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.fullName,
  };
}

export function toTemplateRoleInfo(row: TemplateRole): TemplateRoleInfo {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    routingOrder: row.routingOrder,
    colorIndex: row.colorIndex,
  };
}

export function toTemplateFieldInfo(row: TemplateField): TemplateFieldInfo {
  return {
    id: row.id,
    templateRoleId: row.templateRoleId,
    type: row.type,
    pageNumber: row.pageNumber,
    required: row.required,
    ratioX: row.ratioX,
    ratioY: row.ratioY,
    ratioWidth: row.ratioWidth,
    ratioHeight: row.ratioHeight,
  };
}

export function toTemplateDetail(
  row: WithCounts & { roles: TemplateRole[]; fields: TemplateField[] },
): TemplateDetail {
  return {
    ...toTemplateSummary(row),
    defaultMessage: row.defaultMessage,
    sequentialSigning: row.sequentialSigning,
    reminderIntervalDays: row.reminderIntervalDays,
    roles: [...row.roles]
      .sort((a, b) => a.routingOrder - b.routingOrder || a.colorIndex - b.colorIndex)
      .map(toTemplateRoleInfo),
    fields: row.fields.map(toTemplateFieldInfo),
  };
}
