import type { EnvelopeDetail } from '@envelope/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { formatDateTime } from '../../lib/format';

/**
 * The top of a completed envelope (docs/15 step 8): sealed, when, the finished
 * document's fingerprint, and how anyone can check a copy. The fingerprint is
 * not printed in the PDF itself (docs/06, Correction 3), so the sender finds it
 * here when someone asks about a document.
 */
export function CompletionBanner({
  envelope,
  onDownload,
  downloading,
}: {
  envelope: EnvelopeDetail;
  onDownload: () => void;
  downloading: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (envelope.status !== 'COMPLETED' || !envelope.finalHash) return null;
  const finalHash = envelope.finalHash;

  const copy = async () => {
    await navigator.clipboard.writeText(finalHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      aria-labelledby="completed-heading"
      className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-xs"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h2 id="completed-heading" className="font-semibold text-emerald-950">
              Completed and sealed
            </h2>
            <p className="text-sm text-emerald-900">
              {envelope.completedAt
                ? `Everyone signed. Sealed on ${formatDateTime(envelope.completedAt)}, with a certificate page at the back, and locked so it cannot be changed or deleted.`
                : 'Everyone signed. The finished document is sealed and locked.'}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              {envelope.senderCopySentAt
                ? `Everyone has been emailed the finished document, including you (${formatDateTime(envelope.senderCopySentAt)}).`
                : 'Everyone is emailed the finished document.'}
            </p>
          </div>
        </div>
        <Button onClick={onDownload} loading={downloading} className="shrink-0 text-sm">
          Download signed document
        </Button>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-emerald-950">
            Fingerprint of the finished document (SHA-256)
          </h3>
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            onClick={() => void copy()}
            aria-label="Copy the finished document's fingerprint"
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
        <p
          className="mt-1.5 select-all break-all rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800"
          data-testid="final-hash"
        >
          {finalHash}
        </p>
        <p className="mt-1.5 text-xs text-emerald-900">
          Anyone can check a copy on the{' '}
          <Link to="/verify" target="_blank" className="font-medium underline">
            Verify page
          </Link>
          , or by running <code className="font-mono">sha256sum</code> on the file and comparing.
        </p>
      </div>
    </section>
  );
}
