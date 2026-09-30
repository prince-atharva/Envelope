import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useCopyToClipboard } from '../../lib/use-copy';

/**
 * The ten single-use recovery codes, shown once (docs/19, ADR 0024). They are
 * only ever displayed here: the server keeps just their HMACs, so a code that
 * was not saved cannot be shown again, only replaced.
 */
export function RecoveryCodes({
  codes,
  onDone,
  doneLabel = 'Continue',
}: {
  codes: string[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const { state, copy } = useCopyToClipboard();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Save your recovery codes</h3>
        <p className="mt-1 text-sm text-slate-600">
          If you lose your phone, each of these signs you in once. Keep them somewhere safe: we
          cannot show them again.
        </p>
      </div>
      <ul
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-800"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void copy(codes.join('\n'))}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy codes'}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>I have saved these codes</span>
      </label>
      <Button onClick={onDone} disabled={!saved}>
        {doneLabel}
      </Button>
    </div>
  );
}
