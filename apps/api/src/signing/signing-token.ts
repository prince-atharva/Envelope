import { createHmac, randomBytes } from 'node:crypto';

/**
 * Signing-link tokens (docs/10, ADR 0009).
 *
 * A token is 32 random bytes in hex. Only its HMAC is ever stored, and only the
 * first few characters of that HMAC are ever logged. The raw token lives in the
 * email worker's memory for one send, and in the recipient's inbox.
 */

export interface MintedToken {
  /** Goes into the email link and nowhere else: never stored, logged or queued. */
  rawToken: string;
  /** Stored in Recipient.tokenHash. */
  tokenHash: string;
}

export function hashSigningToken(secret: string, rawToken: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}

export function mintSigningToken(secret: string): MintedToken {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashSigningToken(secret, rawToken) };
}

/**
 * The only form of a token allowed in a log line: 8 characters of its HMAC.
 * Enough to follow one link through the logs, useless for opening it.
 */
export function tokenRef(tokenHash: string): string {
  return tokenHash.slice(0, 8);
}

/** The link that goes into an invitation or reminder. */
export function signingUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/+$/, '')}/sign/${rawToken}`;
}
