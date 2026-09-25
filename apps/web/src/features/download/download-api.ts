import type { DownloadRenewResponse } from '@envelope/shared';
import { errorFrom, networkError, newRequestId, rememberRequestId } from '../../lib/api';

const DOWNLOAD_BASE = '/api/v1/download';

/**
 * One request to the completion download API (docs/15 step 6, docs/17 step
 * 10). Kept apart from the sender client, the same reasoning as
 * `signing-api.ts`: the token is the only credential, so no cookies, no
 * Authorization header, and no Referer.
 */
export async function renewDownloadLink(token: string): Promise<DownloadRenewResponse> {
  const headers = new Headers({ 'X-Request-Id': newRequestId() });
  let res: Response;
  try {
    res = await fetch(`${DOWNLOAD_BASE}/${encodeURIComponent(token)}/renew`, {
      method: 'POST',
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
  return (await res.json()) as DownloadRenewResponse;
}
