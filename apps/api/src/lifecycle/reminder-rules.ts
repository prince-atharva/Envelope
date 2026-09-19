import { type EnvelopeStatus, isOpenEnvelope } from '@envelope/shared';

/** Reminders can be changed while it is open, and while paused: they resume with it. */
export function canChangeReminders(status: EnvelopeStatus): boolean {
  return isOpenEnvelope(status) || status === 'EXPIRED';
}
