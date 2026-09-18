import type { FieldInfo, RecipientInfo } from '@envelope/shared';
import type { DocumentField, Recipient } from '../generated/prisma/client';

/** Database rows to the shapes the API returns. Shared by drafting and sending. */

export function toRecipientInfo(row: Recipient): RecipientInfo {
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

export function toFieldInfo(row: DocumentField): FieldInfo {
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
