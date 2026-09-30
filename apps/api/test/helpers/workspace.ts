import type { Server } from 'node:http';
import type { AuthResponse, CreateApiKeyResponse } from '@envelope/shared';
import request from 'supertest';
import type { TestWorker } from './app';
import { waitFor } from './app';
import { nextClientIp, refreshCookieFrom, type SignedInUser, uniqueEmail } from './auth';
import { bearer } from './signing';

const INVITE_LINK = /\/accept-invite\/([0-9a-f]{64})/;

/** Invites a second person into the owner's workspace and signs them in, through the real flow. */
export async function inviteUser(
  http: Server,
  worker: TestWorker,
  owner: SignedInUser,
  role: 'ADMIN' | 'MEMBER',
  fullName = `Test ${role.toLowerCase()}`,
): Promise<SignedInUser> {
  const email = uniqueEmail(role.toLowerCase());
  await request(http)
    .post('/api/v1/users')
    .set('Authorization', bearer(owner))
    .send({ fullName, email, role })
    .expect(201);
  const message = await waitFor(() =>
    worker.mailbox.messages.filter((m) => m.to === email && m.template === 'user-invited').at(-1),
  );
  const token = INVITE_LINK.exec(message.text)?.[1];
  if (!token) throw new Error('no invite link in the email');
  const password = 'a fresh chosen password';
  const accepted = await request(http)
    .post(`/api/v1/auth/invitations/${token}/accept`)
    .set('X-Forwarded-For', nextClientIp())
    .send({ password })
    .expect(200);
  const body = accepted.body as AuthResponse;
  return {
    email,
    password,
    accessToken: body.accessToken,
    cookie: refreshCookieFrom(accepted),
    body,
  };
}

/** An API key for the owner's workspace; the raw value is what a partner sends as a bearer token. */
export async function createApiKey(
  http: Server,
  owner: SignedInUser,
  options: { readOnly?: boolean; label?: string } = {},
): Promise<{ id: string; authorization: string }> {
  const res = await request(http)
    .post('/api/v1/api-keys')
    .set('Authorization', bearer(owner))
    .send({ label: options.label ?? 'Test key', readOnly: options.readOnly ?? false })
    .expect(201);
  const { apiKey, rawKey } = res.body as CreateApiKeyResponse;
  return { id: apiKey.id, authorization: `Bearer ${rawKey}` };
}
