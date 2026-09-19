import type { VerifyResponse } from '@envelope/shared';
import { errorFrom, networkError, newRequestId, rememberRequestId } from '../../lib/api';

/**
 * POST /api/v1/verify. Public: no cookies and no session, so checking a file
 * never ties it to whoever is signed in on this browser.
 */
export async function verifyDocument(file: File): Promise<VerifyResponse> {
  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetch('/api/v1/verify', {
      method: 'POST',
      body,
      headers: { 'X-Request-Id': newRequestId() },
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw networkError();
  }
  rememberRequestId(res);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as VerifyResponse;
}
