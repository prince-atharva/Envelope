import { BRAND } from '@envelope/shared';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "1edd1d9f3413…11417b155a1" for compact display of a SHA-256. */
export function shortHash(hash: string): string {
  return hash.length <= 24 ? hash : `${hash.slice(0, 12)}…${hash.slice(-10)}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function pageTitle(title?: string): string {
  return title ? `${title} · ${BRAND.fullName}` : BRAND.fullName;
}

const AUDIT_ACTIONS: Record<string, string> = {
  ENVELOPE_CREATED: 'Document uploaded and fingerprinted',
  ENVELOPE_UPDATED: 'Document details changed',
  RECIPIENT_ADDED: 'Person added',
  RECIPIENT_UPDATED: 'Person changed',
  RECIPIENT_REMOVED: 'Person removed',
  FIELDS_SAVED: 'Fields saved',
  ENVELOPE_SENT: 'Sent for signing',
  EMAIL_SENT: 'Email sent',
  REMINDER_REQUESTED: 'Reminder requested',
  ENVELOPE_VIEWED: 'Opened by a signer',
  CONSENT_GIVEN: 'Agreed to sign electronically',
  SIGNATURE_ADOPTED: 'Signature adopted',
  RECIPIENT_SIGNED: 'Signed',
  RECIPIENT_DECLINED: 'Declined',
  VERSION_CREATED: 'Signature stamped into a new version',
  ENVELOPE_COMPLETED: 'Completed and sealed',
  COMPLETION_SENT: 'Finished copy sent',
  ENVELOPE_VOIDED: 'Cancelled',
};

/** Audit actions as people read them. */
export function describeAuditAction(action: string): string {
  return AUDIT_ACTIONS[action] ?? action.toLowerCase().replaceAll('_', ' ');
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 hours ago", "in 2 days": for times near now. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return relative.format(0, 'minute');
}

const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}
