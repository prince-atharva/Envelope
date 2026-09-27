// Keep the displayed verifier executable so tests exercise exactly what users copy (docs/21).
export const WEBHOOK_VERIFIER = `function verifyWebhook(rawBody, timestamp, signature, secret) {
  if (typeof timestamp !== 'string' || !/^\\d{1,12}$/.test(timestamp)) return false;
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const seconds = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature.slice(7), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}`;

export const WEBHOOK_RECEIVER = `import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
// Implement this adapter in your application before running the receiver.
import { saveEventOnce } from './event-inbox.mjs';

const secret = process.env.ENVELOPE_WEBHOOK_SECRET;
if (!secret) throw new Error('Set ENVELOPE_WEBHOOK_SECRET');

${WEBHOOK_VERIFIER}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/envelope') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    if (!verifyWebhook(rawBody, req.headers['x-signature-timestamp'],
        req.headers['x-signature'], secret)) {
      res.writeHead(401).end();
      return;
    }
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); }
    catch { res.writeHead(400).end(); return; }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string'
        || !event.data || typeof event.data !== 'object') {
      res.writeHead(400).end();
      return;
    }
    // Atomically insert into a durable inbox with a UNIQUE event.id.
    // Duplicates must succeed without inserting again. Process in a worker.
    // Return only after commit; throw on storage failure so delivery retries.
    await saveEventOnce(event);
    res.writeHead(204).end();
  } catch {
    res.writeHead(503).end();
  }
}).listen(8080, '127.0.0.1');
// Publish through your HTTPS reverse proxy at /webhooks/envelope.
`;
