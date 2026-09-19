const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** No automatic email while the document has been open this recently: it would break their page. */
export const RECENTLY_SEEN_MS = 60 * 60 * 1000;
/** The "expires soon" email waits if they were emailed this recently. */
export const WARNING_QUIET_MS = DAY_MS;

export type AutomaticEmail = 'interval' | 'expiry-warning';

export interface ReminderRecipient {
  invitedAt: Date | null;
  notifiedAt: Date | null;
  lastRemindedAt: Date | null;
  lastSeenAt: Date | null;
  expiryWarnedAt: Date | null;
}

export interface ReminderEnvelope {
  reminderIntervalDays: number | null;
  expiresAt: Date | null;
}

/** The most recent time we emailed, or tried to email, this person. */
export function lastContact(recipient: ReminderRecipient): Date | null {
  const times = [recipient.invitedAt, recipient.notifiedAt, recipient.lastRemindedAt]
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/**
 * Which automatic email, if any, one person whose turn it is should get now
 * (docs/16 step 10). The caller has already checked that the envelope is open
 * and that they are invited, unfinished and hold an unused link.
 *
 * - Nothing when reminders are off (null interval), past the deadline, or while
 *   they have the document open.
 * - The "expires soon" email once per deadline, within `warningHours` of it,
 *   unless they were emailed in the last day. It wins over an interval
 *   reminder due at the same time.
 * - Otherwise a reminder once the interval has passed since the last email.
 */
export function automaticEmailFor(
  recipient: ReminderRecipient,
  envelope: ReminderEnvelope,
  now: Date,
  warningHours: number,
): AutomaticEmail | null {
  const { reminderIntervalDays, expiresAt } = envelope;
  if (reminderIntervalDays === null || !expiresAt || expiresAt <= now) return null;
  if (recipient.lastSeenAt && now.getTime() - recipient.lastSeenAt.getTime() < RECENTLY_SEEN_MS) {
    return null;
  }
  const contact = lastContact(recipient);
  if (!contact) return null;
  const sinceContact = now.getTime() - contact.getTime();

  const warningWindow = expiresAt.getTime() - now.getTime() <= warningHours * HOUR_MS;
  if (!recipient.expiryWarnedAt && warningWindow) {
    return sinceContact >= WARNING_QUIET_MS ? 'expiry-warning' : null;
  }
  return sinceContact >= reminderIntervalDays * DAY_MS ? 'interval' : null;
}
