import type { TerminalReason } from '@envelope/shared';
import { ApiError } from '../../lib/api';

/**
 * Every way a visit to a signing link can end, each with its own screen
 * (docs/09, "What Happens When Things Go Wrong"). None of them is shown as an
 * error: an expired link or a document already signed is an ordinary situation.
 */
export type EndState =
  /** Not a link we issued, or one replaced by a newer email. */
  | { kind: 'invalid' }
  | { kind: 'expired' }
  /** They signed earlier. Not an error (docs/09: 410, not 401). */
  | { kind: 'already-signed' }
  /** They have just signed, on this page. */
  | { kind: 'signed'; message: string }
  /** They declined, just now (`justNow`) or on an earlier visit. */
  | { kind: 'you-declined'; justNow: boolean }
  /** Someone else declined, which closes the document for everyone. */
  | { kind: 'declined-by-other' }
  | { kind: 'cancelled' }
  /** Closed for a reason we have no better screen for. */
  | { kind: 'closed' };

const TERMINAL: Record<TerminalReason, EndState> = {
  VOIDED: { kind: 'cancelled' },
  DECLINED: { kind: 'declined-by-other' },
  YOU_DECLINED: { kind: 'you-declined', justNow: false },
};

function isTerminalReason(reason: string | undefined): reason is TerminalReason {
  return reason !== undefined && Object.hasOwn(TERMINAL, reason);
}

/**
 * The end screen an API refusal leads to, or null for a failure the signer can
 * recover from (no connection, a slow server, a rejected image, and so on).
 * Any request can return one of these, not just the first: someone else can
 * decline while this person is halfway through.
 */
export function endStateFor(error: unknown): EndState | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'TOKEN_INVALID':
      return { kind: 'invalid' };
    case 'TOKEN_EXPIRED':
      return { kind: 'expired' };
    case 'TOKEN_ALREADY_USED':
      return { kind: 'already-signed' };
    case 'ENVELOPE_TERMINAL':
      return isTerminalReason(error.reason) ? TERMINAL[error.reason] : { kind: 'closed' };
    default:
      return null;
  }
}
