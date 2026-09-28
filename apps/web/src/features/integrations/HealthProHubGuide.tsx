import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import {
  EMBED_BACKEND_EXAMPLE,
  EMBED_EXISTING_EXAMPLE,
  EMBED_IFRAME_EXAMPLE,
  EMBED_SDK_EXAMPLE,
  EMBED_UPLOAD_EXAMPLE,
} from './embed-reference';
import { ExampleBlock } from './IntegrationExampleBlock';

export function HealthProHubGuide({ onManage }: { onManage: () => void }) {
  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <h3 className="text-lg font-semibold">Prepare documents inside your application</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use Envelope’s existing PDF preview, signer controls, fields and review/send screens in an
          iframe. The small SDK opens the editor and reports UI events. Your backend authorizes
          access and keeps the permanent API key. Every tenant can integrate its own application;
          HealthProHub is the worked example below.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Capability</th>
                <th className="p-2">How it works</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2">Headless API</td>
                <td className="p-2">Your server uploads, prepares, sends and reads status.</td>
              </tr>
              <tr>
                <td className="p-2">Embedded preparation</td>
                <td className="p-2">
                  Staff upload or open a draft, add recipients, set fields and send.
                </td>
              </tr>
              <tr>
                <td className="p-2">Recipient signing</td>
                <td className="p-2">
                  Recipients follow emailed links to Envelope’s hosted signing page.
                </td>
              </tr>
              <tr>
                <td className="p-2">SDK distribution</td>
                <td className="p-2">
                  Workspace package available to build; registry/CDN publication is separate.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Button className="mt-4 min-h-11" variant="secondary" onClick={onManage}>
          Configure trusted origins
        </Button>
      </Card>
      <Card className="space-y-4">
        <h3 className="text-lg font-semibold">Choose where uploading happens</h3>
        <p className="text-sm leading-6 text-slate-600">
          <strong>Existing document:</strong> upload the PDF from your application’s backend using
          POST /api/v1/envelopes. Save its id against the business record, request an existing-draft
          session, then open the editor. Close and reopen the same draft with a fresh authorized
          session.
        </p>
        <ExampleBlock
          title="Existing draft session body"
          text={JSON.stringify(EMBED_EXISTING_EXAMPLE, null, 2)}
        />
        <p className="text-sm leading-6 text-slate-600">
          <strong>Upload inside the editor:</strong> request an upload session. Staff choose a PDF
          in the iframe and continue to recipients and fields. One session creates at most one
          draft; a retry recovers that draft.
        </p>
        <ExampleBlock
          title="Upload session body"
          text={JSON.stringify(EMBED_UPLOAD_EXAMPLE, null, 2)}
        />
        <p className="text-sm leading-6 text-slate-600">
          Replace illustrative IDs and origins. The backend must verify draft.created before storing
          the mapping. Edit permissions are required; omit send to allow preparation only. Documents
          can be edited while DRAFT. PDF text editing, replacement uploads, reminders, cancellation
          and Settings are outside the editor.
        </p>
      </Card>
      <Card className="space-y-4">
        <h3 className="text-lg font-semibold">Connect your backend and frontend</h3>
        <p className="text-sm leading-6 text-slate-600">
          Configure the exact application HTTPS origin in Manage connections. ADMIN/OWNER accounts
          manage it with GET/PUT /api/v1/embed/origins. No wildcards or URL paths; HTTP loopback is
          limited to isolated tests. Your host’s frame-src policy must also allow Envelope.
        </p>
        <ExampleBlock title="HealthProHub backend session" text={EMBED_BACKEND_EXAMPLE} />
        <ExampleBlock title="HealthProHub SDK mount" text={EMBED_SDK_EXAMPLE} />
        <details className="rounded-xl border border-slate-200 p-4">
          <summary className="min-h-11 cursor-pointer font-medium">
            Direct iframe alternative
          </summary>
          <div className="mt-4">
            <ExampleBlock title="Direct iframe handshake" text={EMBED_IFRAME_EXAMPLE} />
          </div>
        </details>
        <p className="text-sm leading-6 text-slate-600">
          Never place a launch token or API key in a URL, storage, analytics or logs. The launch
          expires after 60 seconds and can be redeemed once. The editor expires 30 minutes after
          session creation, without refresh or third-party cookies. Key revocation, session
          revocation or removing its origin blocks access. DELETE /api/v1/embed/sessions/:id uses
          the issuing full-access key; POST /api/v1/embed/session/close uses the scoped editor
          bearer.
        </p>
      </Card>
      <Card>
        <h3 className="text-lg font-semibold">Keep your application records up to date</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          SDK events are ready, draft.created, draft.saved, envelope.sent, close, error and
          session.expired. A saved event follows persistence; sent means the signing request was
          accepted, not that anyone signed. Your backend verifies webhook signatures, deduplicates
          event IDs and reconciles status through GET /api/v1/envelopes/:id.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          On envelope.completed, inspect document versions and download the final version explicitly
          with /file?version=N. The default file is the original. Recover a lost browser callback
          with an API read; do not blindly upload or send again. The API and Webhook guide tabs
          cover those existing contracts.
        </p>
      </Card>
      <Card>
        <h3 className="text-lg font-semibold">Embedded editor troubleshooting</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>
            Framing blocked: check your exact configured parent origin, host frame-src, and the
            embedded HTML’s frame-ancestors. Proxy /api to Envelope and preserve its headers. Normal
            sender and signer pages cannot be framed.
          </li>
          <li>
            Invalid, expired or replayed launch: request a new session after rechecking permission.
            Reopen the saved draft rather than creating another envelope.
          </li>
          <li>
            Could not save or stale draft: keep the editor open and resolve the conflict. Close asks
            to save or confirm discarding unsaved changes; destroy removes immediately.
          </li>
          <li>
            Cookies blocked: the embedded transport omits cookies. A login prompt suggests you
            opened a normal sender URL instead of frameUrl.
          </li>
          <li>
            Upload retry: reuse the same active upload session; it returns the already-created
            draft. After session expiry, use the mapped envelopeId to reopen.
          </li>
          <li>
            Session revoked or send denied: check the issuing key, allowed origin and granted
            actions. Editing does not automatically grant sending.
          </li>
          <li>
            Production assets unavailable: build apps/web with its Vite manifest, make dist
            accessible to the API under APP_ROOT_DIR, and serve the matching /assets and PDF.js
            static files on the Envelope origin.
          </li>
        </ul>
      </Card>
    </div>
  );
}
