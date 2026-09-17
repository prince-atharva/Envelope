import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AuthResponse } from '@envelope/shared';
import request, { type Response } from 'supertest';

export const TEST_PASSWORD = 'correct horse battery staple';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

/** The `ds_refresh=...` pair from a response, ready to send back as a Cookie header. */
export function refreshCookieFrom(res: Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith('ds_refresh='));
  if (!cookie) throw new Error('response did not set the refresh cookie');
  return cookie.split(';')[0] ?? '';
}

export interface SignedInUser {
  email: string;
  password: string;
  accessToken: string;
  cookie: string;
  body: AuthResponse;
}

let clientCounter = 0;

/**
 * A distinct client address per call (TEST-NET-2), sent as X-Forwarded-For. The API
 * trusts loopback proxies, so each registration counts against its own rate limit.
 */
export function nextClientIp(): string {
  clientCounter += 1;
  return `198.51.${Math.floor(clientCounter / 250)}.${(clientCounter % 250) + 1}`;
}

export async function registerUser(
  http: Server,
  overrides: Partial<{
    email: string;
    password: string;
    fullName: string;
    organization: string;
  }> = {},
): Promise<SignedInUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? TEST_PASSWORD;
  const res = await request(http)
    .post('/api/v1/auth/register')
    .set('X-Forwarded-For', nextClientIp())
    .send({
      fullName: overrides.fullName ?? 'Test Sender',
      email,
      password,
      organization: overrides.organization ?? 'Test Clinic',
    })
    .expect(201);
  const body = res.body as AuthResponse;
  return { email, password, accessToken: body.accessToken, cookie: refreshCookieFrom(res), body };
}
