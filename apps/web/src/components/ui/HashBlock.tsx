import { useCopyToClipboard } from '../../lib/use-copy';
import { CheckIcon, CopyIcon } from './icons';

/**
 * The document's SHA-256 fingerprint.
 *
 * One component for both places it appears. They had drifted apart: the review
 * screen showed a *truncated* hash under a "SHA-256 Checksum" label and marked
 * it `select-all`, so selecting it by hand copied a string with an ellipsis in
 * the middle while the Copy button beside it copied the full value. A
 * fingerprint that does not match itself is worse than no fingerprint, so the
 * full value is always what is shown and what is copied.
 */
export function HashBlock({
  hash,
  label = 'Document Fingerprint (SHA-256)',
  copyLabel = 'Copy Hash',
  status,
  testId,
}: {
  hash: string;
  label?: string;
  copyLabel?: string;
  /** Short state word shown top right, e.g. "Sealed". */
  status?: string;
  testId?: string;
}) {
  const { state, copy } = useCopyToClipboard();

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5 shadow-inner">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </span>
        {status && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {status}
          </span>
        )}
      </div>

      <p
        data-testid={testId}
        className="select-all break-all py-1 font-mono text-xs leading-relaxed tracking-wide text-slate-100"
      >
        {hash}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
        <button
          type="button"
          onClick={() => void copy(hash)}
          className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold transition-colors ${
            state === 'failed'
              ? 'text-amber-400'
              : 'text-emerald-400 hover:text-emerald-300 focus-visible:outline-emerald-400'
          }`}
        >
          {state === 'copied' ? (
            <>
              <CheckIcon className="h-4 w-4" />
              <span>Copied!</span>
            </>
          ) : state === 'failed' ? (
            <span>Could not copy — select the text above instead</span>
          ) : (
            <>
              <CopyIcon className="h-4 w-4" />
              <span>{copyLabel}</span>
            </>
          )}
        </button>
      </div>
      {/* The outcome is announced, not only recoloured. */}
      <span className="sr-only" role="status">
        {state === 'copied'
          ? 'Fingerprint copied to the clipboard.'
          : state === 'failed'
            ? 'The fingerprint could not be copied. Select it and copy it by hand.'
            : ''}
      </span>
    </div>
  );
}
