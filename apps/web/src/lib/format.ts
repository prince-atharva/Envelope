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

/** Audit actions as people read them. */
export function describeAuditAction(action: string): string {
  const known: Record<string, string> = {
    ENVELOPE_CREATED: 'Document uploaded and fingerprinted',
  };
  return known[action] ?? action.toLowerCase().replaceAll('_', ' ');
}
