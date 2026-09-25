/**
 * The queue only ever carries an id (docs/18): the delivery row in Postgres,
 * not Redis, is the single source of truth for the payload that gets sent,
 * the same way `mail/mail.types.ts`'s jobs carry only ids for the worker to
 * resolve.
 */
export interface WebhookDeliveryJobData {
  deliveryId: string;
}
