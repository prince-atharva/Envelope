import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { EnvelopeDetail, FieldInfo, RecipientResponse } from '@envelope/shared';
import request from 'supertest';
import type { MemoryMailbox, SentEmail } from '../../src/mail/mail-transport.service';
import { makePdf } from '../fixtures/pdfs';
import { waitFor } from './app';
import type { SignedInUser } from './auth';
import { ownerQuery } from './db';

export const bearer = (user: SignedInUser) => `Bearer ${user.accessToken}`;

export interface PersonSpec {
  name: string;
  email: string;
  role?: 'SIGNER' | 'APPROVER' | 'VIEWER' | 'CC';
  routingOrder?: number;
}

export interface PreparedEnvelope {
  id: string;
  recipients: { id: string; email: string; role: string }[];
  fields: FieldInfo[];
}

/**
 * The fields each signer or approver gets: one of every type, spread down
 * page 1, all required except the text box.
 */
function fieldsFor(recipientId: string, column: number): FieldInfo[] {
  const x = 0.05 + column * 0.3;
  const at = (type: FieldInfo['type'], ratioY: number, required = true): FieldInfo => ({
    id: randomUUID(),
    recipientId,
    type,
    pageNumber: 1,
    required,
    ratioX: x,
    ratioY,
    ratioWidth: type === 'CHECKBOX' ? 0.03 : 0.25,
    ratioHeight: type === 'CHECKBOX' ? 0.02 : 0.05,
  });
  return [
    at('SIGNATURE', 0.2),
    at('INITIALS', 0.3),
    at('DATE_SIGNED', 0.4),
    at('TEXT_INPUT', 0.5, false),
    at('CHECKBOX', 0.6),
  ];
}

/**
 * A draft ready to send, built through the real API: people added in order,
 * one of every field type for each signer or approver.
 *
 * `upload` sends a real PDF (needed when the signer will open the document);
 * otherwise the envelope row is inserted directly, which keeps suites clear of
 * the per-tenant upload limit.
 */
export async function prepareEnvelope(
  http: Server,
  owner: SignedInUser,
  people: PersonSpec[],
  options: { sequential?: boolean; upload?: boolean; message?: string } = {},
): Promise<PreparedEnvelope> {
  let id: string;
  if (options.upload) {
    const res = await request(http)
      .post('/api/v1/envelopes')
      .set('Authorization', bearer(owner))
      .attach('file', await makePdf(2), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    id = (res.body as EnvelopeDetail).id;
  } else {
    id = randomUUID();
    await ownerQuery(
      `INSERT INTO "Envelope"
         (id, "tenantId", "ownerId", title, status, "originalFileUrl", "originalFilename",
          "pageCount", "originalHash", "updatedAt")
       VALUES ($1, $2, $3, 'Agreement under test', 'DRAFT', $4, 'agreement.pdf', 2, $5, now())`,
      [id, owner.body.user.tenant.id, owner.body.user.id, `tenants/test/${id}.pdf`, 'a'.repeat(64)],
    );
  }

  if (options.sequential !== undefined || options.message !== undefined) {
    await request(http)
      .patch(`/api/v1/envelopes/${id}`)
      .set('Authorization', bearer(owner))
      .send({
        ...(options.sequential === undefined ? {} : { sequentialSigning: options.sequential }),
        ...(options.message === undefined ? {} : { message: options.message }),
      })
      .expect(200);
  }

  const recipients: PreparedEnvelope['recipients'] = [];
  for (const person of people) {
    const res = await request(http)
      .post(`/api/v1/envelopes/${id}/recipients`)
      .set('Authorization', bearer(owner))
      .send(person)
      .expect(201);
    const { recipient } = res.body as RecipientResponse;
    recipients.push({ id: recipient.id, email: recipient.email, role: recipient.role });
  }

  const fields = recipients
    .filter((recipient) => recipient.role === 'SIGNER' || recipient.role === 'APPROVER')
    .flatMap((recipient, index) => fieldsFor(recipient.id, index % 3));
  if (fields.length > 0) {
    await request(http)
      .put(`/api/v1/envelopes/${id}/fields`)
      .set('Authorization', bearer(owner))
      .send({ fields })
      .expect(200);
  }

  return { id, recipients, fields };
}

export function sendEnvelope(
  http: Server,
  owner: SignedInUser,
  envelopeId: string,
  body: Record<string, unknown> = {},
  idempotencyKey: string = randomUUID(),
) {
  return request(http)
    .post(`/api/v1/envelopes/${envelopeId}/send`)
    .set('Authorization', bearer(owner))
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

const LINK = /\/sign\/([0-9a-f]{64})/;

/** The raw token from the newest signing email to `email`. */
export async function linkFor(mailbox: MemoryMailbox, email: string): Promise<string> {
  const message = await waitFor(() =>
    mailbox.messages
      .filter((m) => m.to === email && (m.template === 'invitation' || m.template === 'reminder'))
      .at(-1),
  );
  return tokenIn(message);
}

export function tokenIn(message: SentEmail): string {
  const match = LINK.exec(message.text);
  if (!match?.[1]) throw new Error(`no signing link in the email to ${message.to}`);
  return match[1];
}

/** Messages of one template to one address. */
export function emailsTo(mailbox: MemoryMailbox, email: string, template?: string): SentEmail[] {
  return mailbox.messages.filter((m) => m.to === email && (!template || m.template === template));
}
