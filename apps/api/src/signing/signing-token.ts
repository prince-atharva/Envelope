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

/**
 * Completion download links (docs/15 step 6) are made the same way, but hashed
 * under their own label, so a download token can never pass for a signing
 * token or the reverse, although both use SIGNING_TOKEN_SECRET.
 */
const DOWNLOAD_LABEL = 'completion-download\0';

export function hashDownloadToken(secret: string, rawToken: string): string {
  return createHmac('sha256', secret).update(DOWNLOAD_LABEL).update(rawToken).digest('hex');
}

export function mintDownloadToken(secret: string): MintedToken {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashDownloadToken(secret, rawToken) };
}

/** The link in a completion email. Served by the API, through the web app's /api. */
/**
 * The web page for a completion email's link (docs/17 step 10), not the API
 * route directly: an already-expired link answers there with a "send me a
 * new link" screen instead of raw JSON. The page itself fetches
 * /api/v1/download/:token to get the file.
 */
export function downloadUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/+$/, '')}/download/${rawToken}`;
}

/** The link that goes into an invitation or reminder. */
export function signingUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/+$/, '')}/sign/${rawToken}`;
}

/**
 * Tenant invitation tokens (docs/17 step 6), made the same way and under
 * their own label, so an invite token can never pass for a signing or
 * download token or the reverse, although all three use SIGNING_TOKEN_SECRET.
 */
const INVITE_LABEL = 'user-invite\0';

export function hashInviteToken(secret: string, rawToken: string): string {
  return createHmac('sha256', secret).update(INVITE_LABEL).update(rawToken).digest('hex');
}

export function mintInviteToken(secret: string): MintedToken {
  const rawToken = randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashInviteToken(secret, rawToken) };
}

/** The link in an invitation email. */
export function inviteUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/+$/, '')}/accept-invite/${rawToken}`;
}
