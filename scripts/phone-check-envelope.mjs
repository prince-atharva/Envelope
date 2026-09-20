/**
 * Builds the three-signer envelope for the real-phone check (doc 15, step 10),
 * against the development server, straight through the API.
 *
 * The builder is deliberately not driven here. Playwright against the
 * development server is unreliable for field placement, because that server is
 * a Vite development build; the browser suite avoids this by serving a
 * production build. The API is deterministic and takes a second.
 *
 * Every signer is a plus-addressed alias of one inbox, so all three
 * invitations and the finished document land in the same place and nothing is
 * sent to an address that would bounce. Signing is sequential, so signers 2
 * and 3 really do see the signatures made before theirs.
 *
 *   # in one shell, with the phone on the same network:
 *   APP_URL=http://<LAN address>:5173 WEB_HOST=0.0.0.0 pnpm dev
 *
 *   # in another:
 *   BASE=http://<LAN address>:5173/api/v1 INBOX=you@gmail.com \
 *     node scripts/phone-check-envelope.mjs
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const say = (message) => process.stdout.write(`${message}\n`);

const BASE = process.env.BASE ?? 'http://localhost:5173/api/v1';
const INBOX = process.env.INBOX;
const PDF = process.env.PDF ?? 'apps/web/e2e/fixtures/test-12-pages.pdf';
const PASSWORD = 'PhoneCheck123!';

if (!INBOX) {
  process.stderr.write(
    'Set INBOX to an address you can read on the phone, e.g. INBOX=you@gmail.com\n',
  );
  process.exit(1);
}

const [user, domain] = INBOX.split('@');
const alias = (tag) => `${user}+${tag}@${domain}`;

let token = null;
let revision = 0;

async function call(method, path, { body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body && !raw) h['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

const senderEmail = alias('sender');

// 1. An account for the sender. A previous run may already have made it, so
// fall back to signing in; `TestPassword123!` is what the browser helpers use.
let auth;
let password = PASSWORD;
try {
  auth = await call('POST', '/auth/register', {
    body: {
      fullName: 'Phone Check',
      organization: 'HealthProHub',
      email: senderEmail,
      password: PASSWORD,
    },
  });
} catch (error) {
  if (!String(error.message).includes('EMAIL_ALREADY_REGISTERED')) throw error;
  for (const candidate of [PASSWORD, 'TestPassword123!']) {
    try {
      auth = await call('POST', '/auth/login', {
        body: { email: senderEmail, password: candidate },
      });
      password = candidate;
      break;
    } catch {
      // try the next one
    }
  }
  if (!auth) throw new Error(`${senderEmail} exists but neither password works.`);
}
token = auth.accessToken ?? auth.token ?? auth.access_token;
if (!token) throw new Error(`No access token in response:\n${JSON.stringify(auth, null, 2)}`);
say(`account    ${senderEmail} / ${password}`);

// 2. Upload the PDF, which creates the draft.
const form = new FormData();
form.append('file', new Blob([await readFile(PDF)], { type: 'application/pdf' }), 'contract.pdf');
form.append('title', 'Phone check contract');
const envelope = await call('POST', '/envelopes', { body: form, raw: true });
const id = envelope.id;
revision = envelope.draftRevision ?? 0;
say(`envelope   ${id}`);

const ifMatch = () => ({ 'if-match': String(revision) });

// 3. One after another, so signers 2 and 3 see the signatures before theirs.
const patched = await call('PATCH', `/envelopes/${id}`, {
  body: { sequentialSigning: true },
  headers: ifMatch(),
});
revision = patched.draftRevision ?? revision + 1;

// 4. Three signers, every one an alias of the same inbox so nothing bounces.
const people = [
  { name: 'Alice Kumar', email: alias('alice') },
  { name: 'Bob Mehta', email: alias('bob') },
  { name: 'Chris Doyle', email: INBOX },
];
const recipients = [];
for (const person of people) {
  const out = await call('POST', `/envelopes/${id}/recipients`, {
    body: { name: person.name, email: person.email, role: 'SIGNER' },
    headers: ifMatch(),
  });
  revision = out.draftRevision ?? revision + 1;
  recipients.push({ ...person });
}

// The add response's shape is not relied on: read the envelope back and match
// on email, which the API stores lower-cased.
const detail = await call('GET', `/envelopes/${id}`);
revision = detail.draftRevision ?? revision;
for (const r of recipients) {
  const found = (detail.recipients ?? []).find(
    (candidate) => candidate.email?.toLowerCase() === r.email.toLowerCase(),
  );
  if (!found) throw new Error(`Recipient ${r.email} not found on the envelope.`);
  r.id = found.id;
  say(`signer ${recipients.indexOf(r) + 1}   ${r.name} <${r.email}>`);
}

// 5. A signature box and a tick box each, side by side on page 1.
const fields = recipients.flatMap((r, i) => [
  {
    id: randomUUID(),
    recipientId: r.id,
    type: 'SIGNATURE',
    pageNumber: 1,
    ratioX: 0.1 + i * 0.28,
    ratioY: 0.55,
    ratioWidth: 0.22,
    ratioHeight: 0.08,
    required: true,
  },
  {
    id: randomUUID(),
    recipientId: r.id,
    type: 'CHECKBOX',
    pageNumber: 1,
    ratioX: 0.1 + i * 0.28,
    ratioY: 0.68,
    ratioWidth: 0.03,
    ratioHeight: 0.03,
    required: true,
  },
]);
const saved = await call('PUT', `/envelopes/${id}/fields`, {
  body: { fields },
  headers: ifMatch(),
});
revision = saved.draftRevision ?? revision + 1;
say(`fields     ${fields.length} placed on page 1`);

// 6. Send. The worker mints a link per person and emails the first one.
await call('POST', `/envelopes/${id}/send`, {
  body: { expiresInDays: 7, message: 'Real-phone check for Phase 4, step 10.' },
  headers: { 'idempotency-key': randomUUID() },
});

say(`\nSENT. Watch ${INBOX} for the invitation to Alice.`);
say(`Sender view: ${BASE.replace(/\/api\/v1$/, '')}/dashboard/envelopes/${id}`);
