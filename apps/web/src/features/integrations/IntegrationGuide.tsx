import {
  DOCUMENT_CATEGORIES,
  FIRED_WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
} from '@envelope/shared';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { HealthProHubGuide } from './HealthProHubGuide';
import { ExampleBlock } from './IntegrationExampleBlock';

export { ExampleBlock } from './IntegrationExampleBlock';

import { WEBHOOK_EVENT_LABELS } from './integration-presentation';
import {
  apiBaseUrl,
  ENDPOINTS,
  type EndpointReference,
  requestExample,
  WEBHOOK_EXAMPLES,
  webhookExample,
} from './integration-reference';
import { WEBHOOK_RECEIVER } from './webhook-receiver-example';

function EndpointCard({ endpoint, base }: { endpoint: EndpointReference; base: string }) {
  return (
    <details className="group min-w-0 rounded-xl border border-slate-200 bg-white open:shadow-sm">
      <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-3 rounded-xl p-4 focus-visible:outline-brand-700">
        <span
          className={`rounded-md px-2 py-1 font-mono text-xs font-bold ${endpoint.method === 'GET' ? 'bg-emerald-50 text-emerald-800' : endpoint.method === 'DELETE' ? 'bg-red-50 text-red-800' : 'bg-brand-50 text-brand-800'}`}
        >
          {endpoint.method}
        </span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block break-all font-mono text-xs font-medium text-slate-800">
            {endpoint.path}
          </span>
          <span className="mt-1 block text-sm text-slate-500">{endpoint.title}</span>
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {endpoint.method === 'GET' ? 'Read or full access' : 'Full access'}
        </span>
        <span aria-hidden="true" className="text-slate-400 group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4 sm:p-5">
        <p className="text-sm leading-6 text-slate-600">{endpoint.description}</p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          {endpoint.inputs.map((input) => (
            <li key={input}>{input}</li>
          ))}
        </ul>
        {endpoint.id === 'upload' && (
          <p className="text-xs leading-6 text-slate-500">
            Document categories: {DOCUMENT_CATEGORIES.join(', ')}. The chosen jurisdiction may block
            some categories.
          </p>
        )}
        {endpoint.revision && (
          <Alert tone="info">
            Send the latest draftRevision in If-Match, quoted. After each successful edit, replace
            DRAFT_REVISION with the returned value. On 412, fetch the draft again and reconcile
            before retrying.
          </Alert>
        )}
        <ExampleBlock title={`${endpoint.title} request`} text={requestExample(endpoint, base)} />
        <p className="text-xs font-medium text-slate-500">{endpoint.responseNote}</p>
        <ExampleBlock
          title={`${endpoint.title} response`}
          text={
            typeof endpoint.response === 'string'
              ? endpoint.response
              : JSON.stringify(endpoint.response, null, 2)
          }
        />
        <p className="text-sm leading-6 text-slate-600">
          <strong className="text-slate-800">When it fails: </strong>
          {endpoint.errors}
        </p>
      </div>
    </details>
  );
}

const sections = [
  { id: 'start', label: 'Quick start' },
  { id: 'api', label: 'API reference' },
  { id: 'webhooks', label: 'Webhook guide' },
  { id: 'help', label: 'Troubleshooting' },
  { id: 'healthprohub', label: 'Embedded editor' },
] as const;
type Section = (typeof sections)[number]['id'];

export function IntegrationGuide({ onManage }: { onManage: () => void }) {
  const prefix = useId();
  const [section, setSection] = useState<Section>('start');
  const [search, setSearch] = useState('');
  const [event, setEvent] = useState<WebhookEventType>('envelope.completed');
  const base = apiBaseUrl(window.location.origin);
  const filtered = ENDPOINTS.filter((entry) =>
    `${entry.method} ${entry.path} ${entry.title} ${entry.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="min-w-0 space-y-5">
      <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-brand-50/70 via-white to-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
              Build with Envelope
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              From your application to a signed document
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Send documents through the HTTP API. Receive signed event notifications when something
              changes. Everything you need to connect your server is here.
            </p>
          </div>
          <Button variant="secondary" className="min-h-11 shrink-0 self-start" onClick={onManage}>
            Manage connections
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-brand-800">
          {['12 API operations', '8 webhook events', 'Server-to-server'].map((label) => (
            <span key={label} className="rounded-full border border-brand-100 bg-white px-3 py-1.5">
              {label}
            </span>
          ))}
        </div>
      </Card>
      <Tabs
        idPrefix={prefix}
        label="Integration guide sections"
        items={sections}
        value={section}
        onChange={setSection}
        variant="underline"
        className="[&_button]:min-h-11"
      />
      <TabPanel idPrefix={prefix} id="healthprohub" hidden={section !== 'healthprohub'}>
        {section === 'healthprohub' && <HealthProHubGuide onManage={onManage} />}
      </TabPanel>
      <TabPanel idPrefix={prefix} id="start" hidden={section !== 'start'} className="space-y-5">
        {section === 'start' && (
          <>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">1. Create a server API key</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Open Manage connections and create a full-access API key for sending, or a read-only
                key for reporting. Copy it once into your server’s secret manager. Both key types
                operate across this workspace; a full-access key can only call the operations listed
                here.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Set ENVELOPE_API_KEY in your server environment. Keep keys out of frontend code,
                repositories and logs. API keys and webhook signing secrets are different
                credentials.
              </p>
              <div className="mt-4">
                <ExampleBlock title="API base URL" text={base} />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                This is the API on the current application origin. Use your publicly reachable
                deployment URL from another server; localhost only works on this machine. Requests
                use Authorization: Bearer and JSON, except PDF uploads (multipart) and downloads
                (binary).
              </p>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">2. Upload → prepare → send</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Expand each step for its request and response. Examples use illustrative UUIDs:
                replace the envelope id in every URL and the recipientId in the field body with
                values returned by your requests.
              </p>
              <ol className="my-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>Upload agreement.pdf. Save id and draftRevision.</li>
                <li>
                  Add Alex as a recipient. Save recipient.id and update DRAFT_REVISION from the
                  response.
                </li>
                <li>
                  Place a required signature field using that recipient id. Generate a fresh field
                  UUID; update DRAFT_REVISION again.
                </li>
                <li>
                  Set SEND_IDEMPOTENCY_KEY to a fresh UUID for this send. Reuse it with the same
                  body on retries. Send the document.
                </li>
              </ol>
              <div className="space-y-3">
                {['upload', 'recipient-add', 'fields', 'send'].map((id) => {
                  const endpoint = ENDPOINTS.find((entry) => entry.id === id);
                  return endpoint ? (
                    <EndpointCard key={id} endpoint={endpoint} base={base} />
                  ) : null;
                })}
              </div>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">
                3. Listen for completion and download
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Recipients sign on Envelope using their emailed links. Subscribe to
                envelope.completed, verify the event and use data.finalVersionNumber with GET
                /envelopes/:id/file?version=…. You can also read document detail and choose the
                version marked isFinal. Version 0 is always the original.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button className="min-h-11" onClick={() => setSection('webhooks')}>
                  Set up a webhook receiver
                </Button>
                <Button variant="secondary" className="min-h-11" onClick={() => setSection('api')}>
                  Explore all API operations
                </Button>
              </div>
            </Card>
          </>
        )}
      </TabPanel>
      <TabPanel idPrefix={prefix} id="api" hidden={section !== 'api'} className="space-y-4">
        {section === 'api' && (
          <>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">API reference</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Paths below are relative to {base}. Every request requires your server API key. All
                IDs are UUIDs; timestamps are UTC ISO strings.
              </p>
            </div>
            <Alert tone="info">
              API-key and webhook management, users, compliance, cancellation, reminders and
              deadline extensions require a signed-in session. Signer routes use emailed signing
              tokens. A full-access key does not grant these capabilities.
            </Alert>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Search API operations</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by method, path or task…"
                className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <p role="status" className="text-xs text-slate-500">
              {filtered.length} of {ENDPOINTS.length} operations
            </p>
            {filtered.length ? (
              filtered.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} base={base} />
              ))
            ) : (
              <Card>
                <p className="text-sm text-slate-600">
                  No matching operations. Try “GET”, “recipient” or “send”.
                </p>
                <Button variant="secondary" className="mt-3 min-h-11" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              </Card>
            )}
          </>
        )}
      </TabPanel>
      <TabPanel
        idPrefix={prefix}
        id="webhooks"
        hidden={section !== 'webhooks'}
        className="space-y-5"
      >
        {section === 'webhooks' && (
          <>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">
                Receive events on your server
              </h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>
                  Publish a POST receiver at a public HTTPS address, for example
                  https://your-app.example/webhooks/envelope. Private addresses, localhost and
                  redirects are not supported.
                </li>
                <li>
                  In Manage connections, choose Add webhook, enter the receiver URL and select all
                  events or specific events. Up to five endpoints can be registered per workspace.
                </li>
                <li>
                  Copy the signing secret once into your server’s ENVELOPE_WEBHOOK_SECRET
                  environment variable. If lost, deactivate the endpoint and create a replacement.
                </li>
                <li>
                  Verify each request, durably record it and return a 2xx response within five
                  seconds. Process business work in the background.
                </li>
              </ol>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">Event payloads</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Envelope sends an application/json POST to your receiver. id identifies the event,
                type names the change, createdAt is the event creation time and data contains
                event-specific fields. Event time and delivery time can differ.
              </p>
              <label className="my-4 block">
                <span className="text-sm font-medium text-slate-700">Webhook event</span>
                <select
                  value={event}
                  onChange={(e) => setEvent(e.target.value as WebhookEventType)}
                  className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {FIRED_WEBHOOK_EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type} — {WEBHOOK_EVENT_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mb-4 text-sm leading-6 text-slate-600">
                {WEBHOOK_EXAMPLES[event]?.description}
              </p>
              <ExampleBlock title="Webhook payload" text={webhookExample(event)} />
              <p className="mt-3 text-xs leading-6 text-slate-500">
                envelope.delivered is reserved and never emitted: SMTP acceptance does not prove
                inbox delivery. Use envelope.sent and envelope.viewed. Some events include recipient
                email addresses; protect stored payloads as personal data.
              </p>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">Verify before you trust</h3>
              <p className="my-3 text-sm leading-6 text-slate-600">
                Read X-Signature-Timestamp (Unix seconds) and X-Signature (sha256= followed by a hex
                digest). Compute HMAC-SHA256 over the timestamp, a period and the exact raw request
                bytes, using your signing secret. Reject timestamps outside five minutes and compare
                in constant time. Do not parse or reserialize JSON before verification.
              </p>
              <p className="mb-4 text-sm leading-6 text-slate-600">
                While you rotate a signing secret, X-Signature lists two signatures separated by a
                comma, the new secret first: sha256=NEW,sha256=OLD. Accept the request when any one
                of them matches the secret you hold; the example below does. This lets you switch
                your receiver to the new secret before the old one stops working.
              </p>
              <ExampleBlock title="Node.js receiver example" text={WEBHOOK_RECEIVER} />
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Before running this example, implement event-inbox.mjs: saveEventOnce must
                atomically store the event with a unique event.id and treat duplicates as success. A
                worker processes the durable inbox with idempotent business actions. An in-memory
                set is not enough across restarts or multiple servers. Publish the local receiver
                through an HTTPS reverse proxy.
              </p>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">
                Acknowledge, retry and inspect
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Return 204 No Content after durable acceptance; no JSON response body is required.
                Duplicates are expected, including after retries or manual redrive. Deduplicate by
                event.id, not the signature timestamp or delivery id. Do not rely on events arriving
                in order; read current document status when needed.
              </p>
              <ExampleBlock title="Receiver acknowledgement" text={'HTTP/1.1 204 No Content'} />
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Non-2xx responses and timeouts cause retries with increasing delays. In Manage
                connections → Deliveries, filter by status or event, load more, and inspect
                attempts, last HTTP status, next scheduled retry, errors and event data. Failed
                deliveries can be retried within seven days; delivery history is purged after that
                window. The displayed event data is what Envelope sent, not your server’s response
                body.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use Send test event on an endpoint to check your receiver: it delivers one
                webhook.test event, signed like any other, with one attempt and no retries. Treat it
                as a normal request that needs no action, and expect it in Deliveries. A test never
                counts toward automatic deactivation. An endpoint whose deliveries fail every retry
                ten times in a row (the default) is turned off and your workspace admins are
                emailed; fix the receiver, send a test event and reactivate it. Deactivated
                endpoints do not use one of your five active slots and can be deleted permanently.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The management redrive route uses a delivery id, not an endpoint id, and requires a
                signed-in session; GET /webhooks/deliveries lists across every endpoint at once,
                with the same filters the Deliveries dialog offers. Use the Deliveries dialog to
                retry after fixing the receiver.
              </p>
            </Card>
          </>
        )}
      </TabPanel>
      <TabPanel idPrefix={prefix} id="help" hidden={section !== 'help'} className="space-y-4">
        {section === 'help' && (
          <>
            <Card>
              <h3 className="text-lg font-semibold text-slate-900">Understand an API error</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Errors use application/problem+json. Check the HTTP status and code; use requestId
                when asking for help. Validation errors can include field-level errors. Never
                include your API key or signing secret in a support request.
              </p>
            </Card>
            {[
              [
                '401 · Authentication',
                'Check Authorization: Bearer, verify the server environment contains the full key and confirm it has not been revoked. Key prefixes shown in Settings cannot authenticate.',
              ],
              [
                '403 · Access denied',
                'A read-only key cannot write. Even a full-access key is refused on session-only routes. Confirm the operation is in the API reference and the key belongs to the intended workspace.',
              ],
              [
                '404 · Document unavailable',
                'Check the UUID and workspace. A key cannot read another workspace’s document.',
              ],
              [
                '400 / 422 · Invalid input',
                'Inspect code and any field errors. Use multipart for upload and JSON for edits. Check recipient IDs, page numbers and page-relative coordinates. Document categories may be blocked by jurisdiction policy.',
              ],
              [
                '409 / 412 · Draft changed',
                'Edits require a draft. On a revision mismatch, read the latest detail and reconcile your changes before retrying with the returned draftRevision. Do not blindly overwrite another update.',
              ],
              [
                '429 · Too many requests',
                'Respect Retry-After, reduce concurrency and back off with jitter. Create and send share a workspace limit of 100 requests per minute; upload and general request limits also apply.',
              ],
              [
                'Send refused',
                'Check NOT_READY_TO_SEND issues. Add a signer or approver and a required field for every signer. Keep the same Idempotency-Key and body when retrying a send after a network failure. Upload and recipient creation do not offer that send replay guarantee.',
              ],
              [
                'Webhook not arriving',
                'Check that the endpoint is active, subscribed to the event and reachable over public HTTPS. Inspect Deliveries. envelope.delivered is not emitted. A local development receiver needs a publicly reachable HTTPS proxy.',
              ],
              [
                'Signature mismatch or repeated delivery',
                'Use the signing secret, not the API key. Verify untouched request bytes and timestamp; keep the server clock accurate. During a secret rotation X-Signature carries two comma-separated signatures; accept if either matches. Acknowledge promptly after durable storage and deduplicate event.id.',
              ],
            ].map(([title, description]) => (
              <Card key={title}>
                <h4 className="font-semibold text-slate-900">{title}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </Card>
            ))}
          </>
        )}
      </TabPanel>
    </div>
  );
}
