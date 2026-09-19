import { describe, expect, it } from 'vitest';
import { automaticEmailFor, lastContact, type ReminderRecipient } from './auto-reminder-rules';

const NOW = new Date('2026-10-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const invited: ReminderRecipient = {
  invitedAt: hoursAgo(4 * 24),
  notifiedAt: hoursAgo(4 * 24),
  lastRemindedAt: null,
  lastSeenAt: null,
  expiryWarnedAt: null,
};
const everyThreeDays = { reminderIntervalDays: 3, expiresAt: inHours(10 * 24) };

describe('automaticEmailFor', () => {
  it('reminds once the interval has passed since the last email', () => {
    expect(automaticEmailFor(invited, everyThreeDays, NOW, 48)).toBe('interval');
    const recent = { ...invited, lastRemindedAt: hoursAgo(2 * 24) };
    expect(automaticEmailFor(recent, everyThreeDays, NOW, 48)).toBeNull();
  });

  it('sends nothing when reminders are off or the deadline has passed', () => {
    expect(
      automaticEmailFor(invited, { ...everyThreeDays, reminderIntervalDays: null }, NOW, 48),
    ).toBeNull();
    expect(
      automaticEmailFor(invited, { ...everyThreeDays, expiresAt: hoursAgo(1) }, NOW, 48),
    ).toBeNull();
  });

  it('waits while they have the document open', () => {
    expect(
      automaticEmailFor({ ...invited, lastSeenAt: hoursAgo(0.5) }, everyThreeDays, NOW, 48),
    ).toBeNull();
    expect(
      automaticEmailFor({ ...invited, lastSeenAt: hoursAgo(2) }, everyThreeDays, NOW, 48),
    ).toBe('interval');
  });

  it('warns once before the deadline, instead of a reminder due at the same time', () => {
    const closing = { ...everyThreeDays, expiresAt: inHours(40) };
    expect(automaticEmailFor(invited, closing, NOW, 48)).toBe('expiry-warning');
    const warned = { ...invited, expiryWarnedAt: hoursAgo(30), lastRemindedAt: hoursAgo(30) };
    expect(automaticEmailFor(warned, closing, NOW, 48)).toBeNull();
  });

  it('holds the warning back if they were emailed in the last day', () => {
    const closing = { ...everyThreeDays, expiresAt: inHours(40) };
    expect(automaticEmailFor({ ...invited, notifiedAt: hoursAgo(5) }, closing, NOW, 48)).toBeNull();
  });

  it('never emails someone who was never invited', () => {
    const never = { ...invited, invitedAt: null, notifiedAt: null };
    expect(automaticEmailFor(never, everyThreeDays, NOW, 48)).toBeNull();
    expect(lastContact(never)).toBeNull();
  });
});
