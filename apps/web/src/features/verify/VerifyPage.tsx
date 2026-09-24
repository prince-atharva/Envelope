import { MAX_UPLOAD_BYTES, type VerifyResponse } from '@envelope/shared';
import { type DragEvent, useId, useState } from 'react';
import { PublicFrame } from '../../components/layout/PublicFrame';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { describeError } from '../../lib/errors';
import { describeAuditAction, formatBytes, formatDateTime } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-document-title';
import { describeOutcome, type Tone } from './outcome';
import { verifyDocument } from './verify-api';

type Verified = Extract<VerifyResponse, { verified: true }>;

const TONES: Record<Tone, { box: string; icon: string; path: string }> = {
  verified: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: 'bg-emerald-600 text-white',
    path: 'M5 13l4 4L19 7',
  },
  partial: {
    box: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: 'bg-amber-500 text-white',
    path: 'M12 8v5m0 3.5v.5',
  },
  unknown: {
    box: 'border-slate-200 bg-slate-50 text-slate-900',
    icon: 'bg-slate-500 text-white',
    path: 'M12 8v5m0 3.5v.5',
  },
};

/**
 * Verify (docs/15 step 7): anyone checks whether a PDF is exactly a document
 * signed here. Public, like the signing portal: no account, no sender session.
 */
export default function VerifyPage() {
  useDocumentTitle('Verify a document');
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);

  async function check(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError({ message: `That file is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.` });
      return;
    }
    setFileName(file.name);
    setChecking(true);
    try {
      setResult(await verifyDocument(file));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setChecking(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void check(event.dataTransfer.files[0]);
  }

  return (
    <PublicFrame wide backTo="/dashboard">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Verify a document</h1>
      <p className="mt-1 text-sm text-slate-600">
        Check whether a PDF is exactly a document signed here. The file is only fingerprinted: it is
        not kept, and nobody is told you checked it.
      </p>

      <div className="mt-6 space-y-5">
        {error && <Alert reference={error.reference}>{error.message}</Alert>}

        {result ? (
          <Result result={result} fileName={fileName} onReset={() => setResult(null)} />
        ) : (
          <label
            htmlFor={inputId}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
              dragging
                ? 'border-brand-600 bg-brand-50'
                : 'border-slate-300 bg-white hover:border-brand-500'
            } ${checking ? 'pointer-events-none opacity-60' : ''}`}
          >
            {checking ? (
              <>
                <Spinner />
                <span className="mt-3 font-medium text-slate-900">Checking {fileName}…</span>
              </>
            ) : (
              <>
                <span className="font-medium text-slate-900">
                  Drop a PDF here, or click to choose
                </span>
                <span className="mt-1 text-sm text-slate-500">
                  Up to {formatBytes(MAX_UPLOAD_BYTES)}
                </span>
              </>
            )}
            <input
              id={inputId}
              type="file"
              name="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={checking}
              onChange={(event) => {
                void check(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
        )}

        <p className="text-xs text-slate-500">
          You can also check a file without this page. The completion email gives the finished
          document’s fingerprint; run <code className="font-mono">sha256sum</code> (or{' '}
          <code className="font-mono">shasum -a 256</code> on a Mac) on your copy and compare.
        </p>
      </div>
    </PublicFrame>
  );
}

function Result({
  result,
  fileName,
  onReset,
}: {
  result: VerifyResponse;
  fileName: string | null;
  onReset: () => void;
}) {
  const outcome = describeOutcome(result);
  const tone = TONES[outcome.tone];
  return (
    <div className="space-y-5" data-testid="verify-result" data-outcome={outcome.tone}>
      <div className={`flex gap-3 rounded-xl border p-4 ${tone.box}`} role="status">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
            <path
              d={tone.path}
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          <h2 className="font-semibold">{outcome.title}</h2>
          <p className="mt-1 text-sm">{outcome.body}</p>
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
        {fileName && (
          <>
            <dt className="text-slate-500">File</dt>
            <dd className="break-all text-slate-900">{fileName}</dd>
          </>
        )}
        <dt className="text-slate-500">Fingerprint</dt>
        <dd className="break-all font-mono text-xs text-slate-900" data-testid="verify-hash">
          {result.documentHash}
        </dd>
      </dl>

      {result.verified && <Details result={result} />}

      <Button variant="secondary" onClick={onReset}>
        Check another file
      </Button>
    </div>
  );
}

function Details({ result }: { result: Verified }) {
  return (
    <div className="space-y-5 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
        <dt className="text-slate-500">Document</dt>
        <dd className="text-slate-900">{result.title}</dd>
        {result.completedAt && (
          <>
            <dt className="text-slate-500">Completed</dt>
            <dd className="text-slate-900">{formatDateTime(result.completedAt)}</dd>
          </>
        )}
      </dl>

      <section>
        <h3 className="font-medium text-slate-900">Signers</h3>
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {result.signers.map((signer) => (
            <li
              key={`${signer.maskedEmail}-${signer.name}`}
              className="flex flex-wrap justify-between gap-2 px-3 py-2"
            >
              <span>
                <span className="font-medium text-slate-900">{signer.name}</span>{' '}
                <span className="text-slate-500">{signer.maskedEmail}</span>
                {signer.role === 'APPROVER' && (
                  <span className="ml-1 text-xs text-slate-500">(approver)</span>
                )}
              </span>
              <span className="text-slate-600">
                {signer.signedAt ? `Signed ${formatDateTime(signer.signedAt)}` : 'Not signed'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-medium text-slate-900">Versions</h3>
        <p className="text-xs text-slate-500">
          Each signature made a new copy with its own fingerprint.
        </p>
        <ol className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {result.versionChain.map((version) => {
            const isThis = version.versionNumber === result.matched.versionNumber;
            return (
              <li
                key={version.versionNumber}
                className={`px-3 py-2 ${isThis ? 'bg-brand-50' : ''}`}
                aria-current={isThis ? 'true' : undefined}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    v{version.versionNumber}{' '}
                    <span className="font-normal text-slate-600">
                      {version.isFinal
                        ? 'Sealed, with the certificate'
                        : version.signedBy
                          ? `Signed by ${version.signedBy}`
                          : 'Original upload'}
                    </span>
                    {isThis && (
                      <span className="ml-2 rounded bg-brand-700 px-1.5 py-0.5 text-xs text-white">
                        This file
                      </span>
                    )}
                  </span>
                  <span className="text-slate-500">{formatDateTime(version.createdAt)}</span>
                </div>
                <div className="mt-0.5 break-all font-mono text-xs text-slate-500">
                  {version.sha256}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <details className="rounded-lg border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer font-medium text-slate-900">
          History ({result.events.length} events)
        </summary>
        <ol className="mt-2 space-y-1">
          {result.events.map((event) => (
            <li key={event.sequence} className="flex flex-wrap gap-x-3 text-slate-700">
              <span className="w-40 shrink-0 text-slate-500">
                {formatDateTime(event.timestamp)}
              </span>
              <span>
                {describeAuditAction(event.action)}
                <span className="text-slate-500"> · {event.actor}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
