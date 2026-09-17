import { MAX_PDF_PAGES, MAX_UPLOAD_BYTES } from '@digitalsign/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type FormEvent, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { formatBytes } from '../lib/format';
import { useDocumentTitle } from '../lib/use-document-title';

const PDF_SIGNATURE = '%PDF-';

/** Quick checks before uploading. The server repeats every one of them. */
async function checkFile(file: File): Promise<string | null> {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.size)}. PDFs can be at most ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  const head = new TextDecoder().decode(await file.slice(0, PDF_SIGNATURE.length).arrayBuffer());
  if (head !== PDF_SIGNATURE) return 'That file is not a PDF.';
  return null;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.pdf$/i, '').trim();
}

type Phase = 'idle' | 'uploading' | 'processing';

export function NewEnvelopePage() {
  useDocumentTitle('Upload document');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);

  async function choose(candidate: File | undefined) {
    if (!candidate) return;
    setError(null);
    const problem = await checkFile(candidate);
    if (problem) {
      setFile(null);
      setError({ message: problem });
      return;
    }
    setFile(candidate);
    setTitle(titleFromFileName(candidate.name));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError({ message: 'Choose a PDF to upload.' });
      return;
    }
    setError(null);
    setPhase('uploading');
    setProgress(0);
    try {
      const envelope = await api.uploadEnvelope(file, title.trim() || undefined, (fraction) => {
        setProgress(fraction);
        if (fraction >= 1) setPhase('processing');
      });
      await queryClient.invalidateQueries({ queryKey: ['envelopes'] });
      await navigate(`/dashboard/envelopes/${envelope.id}`);
    } catch (caught) {
      setError(describeError(caught));
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload a document</h1>
        <p className="mt-1 text-sm text-slate-600">
          PDF only, up to {formatBytes(MAX_UPLOAD_BYTES)} and {MAX_PDF_PAGES} pages. Each file is
          checked for hidden scripts and fingerprinted before it is stored.
        </p>
      </div>

      <form className="space-y-5" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error && <Alert reference={error.reference}>{error.message}</Alert>}

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
          } ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 text-brand-700"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {file ? (
            <>
              <span className="mt-3 font-medium text-slate-900">{file.name}</span>
              <span className="text-sm text-slate-500">
                {formatBytes(file.size)} · click to choose another
              </span>
            </>
          ) : (
            <>
              <span className="mt-3 font-medium text-slate-900">
                Drop a PDF here, or click to choose
              </span>
              <span className="text-sm text-slate-500">
                Your file stays private to your workspace
              </span>
            </>
          )}
          <input
            id={inputId}
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>

        {file && (
          <TextField
            label="Document title"
            name="title"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            hint="Shown in your document list. Defaults to the file name."
            disabled={busy}
          />
        )}

        {busy && (
          <div aria-live="polite">
            <div className="flex justify-between text-xs text-slate-600">
              <span>{phase === 'uploading' ? 'Uploading…' : 'Checking and fingerprinting…'}</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <ButtonLink to="/dashboard" variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" loading={busy} disabled={!file}>
            Upload document
          </Button>
        </div>
      </form>
    </div>
  );
}
