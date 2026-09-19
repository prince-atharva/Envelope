import type {
  AdoptSignatureInput,
  AdoptSignatureResponse,
  ConsentInput,
  ConsentResponse,
  DeclineInput,
  DeclineResponse,
  MoreTimeResponse,
  SigningSession,
  SubmitSigningInput,
  SubmitSigningResponse,
} from '@envelope/shared';
import { ApiError, errorFrom, networkError, newRequestId, rememberRequestId } from '../../lib/api';

const SIGNING_BASE = '/api/v1/sign';

/** Query keys for the signer portal. The cache is in memory only, for this page. */
export const signingKeys = {
  all: (token: string) => ['signing', token] as const,
  session: (token: string) => ['signing', token, 'session'] as const,
  document: (token: string) => ['signing', token, 'document'] as const,
};

/**
 * One request to the signer API (docs/08, "Signing Session").
 *
 * Kept apart from the sender client on purpose. The link is the signer's only
 * credential, so:
 * - no cookies and no Authorization header: a sender who happens to be signed
 *   in on this browser must not lend their session to someone else's link;
 * - no Referer: the page's own URL holds the token (docs/10);
 * - no HTTP cache: the answers are personal and change as the person signs.
 */
async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Request-Id', newRequestId());
  let res: Response;
  try {
    res = await fetch(`${SIGNING_BASE}/${encodeURIComponent(token)}${path}`, {
      ...init,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw networkError();
  }
  rememberRequestId(res);
  if (!res.ok) throw await errorFrom(res);
  return res;
}

async function post<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await request(token, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export const signingApi = {
  session: async (token: string) => (await request(token, '')).json() as Promise<SigningSession>,

  /** The PDF. Refused with CONSENT_REQUIRED until the signer has agreed (docs/07). */
  document: async (token: string) => (await request(token, '/document')).arrayBuffer(),

  consent: (token: string, input: ConsentInput) => post<ConsentResponse>(token, '/consent', input),

  adopt: (token: string, input: AdoptSignatureInput) =>
    post<AdoptSignatureResponse>(token, '/adopt', input),

  submit: (token: string, input: SubmitSigningInput) =>
    post<SubmitSigningResponse>(token, '/submit', input),

  decline: (token: string, input: DeclineInput) => post<DeclineResponse>(token, '/decline', input),

  /** The one thing an expired link can do: ask the sender for more time (docs/16 step 8). */
  requestMoreTime: (token: string) => post<MoreTimeResponse>(token, '/request-more-time', {}),
};

/** A failure worth trying again: no connection, or the server's own fault. */
export function isTransient(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/**
 * Runs `attempt`, and on a transient failure tries again after 1, 2 and 4
 * seconds (docs/09, "Offline resilience"). Anything else fails at once: a
 * refusal will not change by asking again.
 */
export async function withBackoff<T>(
  attempt: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      const delay = delays[tries];
      if (delay === undefined || !isTransient(error)) throw error;
      await wait(delay);
    }
  }
}
