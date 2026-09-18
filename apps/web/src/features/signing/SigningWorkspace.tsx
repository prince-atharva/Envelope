import type { SignatureKind, SigningField, SigningSession } from '@envelope/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { LogoMark } from '../../components/brand/Logo';
import { PdfViewer } from '../../components/pdf/PdfViewer';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { reportError } from '../../lib/logger';
import { useDocumentTitle } from '../../lib/use-document-title';
import { type Adoption, AdoptSheet } from './AdoptSheet';
import { DeclineDialog } from './DeclineDialog';
import {
  clearDraft,
  draftKey,
  loadAdoptedImages,
  loadDraft,
  pruneDrafts,
  saveAdoptedImage,
  saveDraft,
} from './drafts';
import { type EndState, endStateFor } from './end-states';
import { SigningFieldLayer } from './SigningFieldLayer';
import { isTransient, signingApi, signingKeys, withBackoff } from './signing-api';
import {
  type Adopted,
  fieldTypeName,
  isFilled,
  isSignatureKind,
  nextField,
  SIGNED_MARK,
  signingProgress,
  toSubmission,
} from './signing-state';
import { TextSheet } from './TextSheet';

type OpenSheet =
  | { type: 'adopt'; kind: SignatureKind; field: SigningField }
  | { type: 'text'; field: SigningField }
  | { type: 'decline' };

const FLASH_KEYFRAMES: Keyframe[] = [
  { boxShadow: '0 0 0 0 rgb(13 148 136 / 0)' },
  { boxShadow: '0 0 0 8px rgb(13 148 136 / 0.45)', offset: 0.3 },
  { boxShadow: '0 0 0 0 rgb(13 148 136 / 0)' },
];

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The document with the signer's boxes on it (docs/09, "Guided navigation").
 *
 * A bar along the bottom always says how much is left and takes them to the
 * next box, so nobody has to scroll a long contract hunting for page 34. When
 * nothing required is left, the same button becomes Finish.
 *
 * Every change is saved on the device as it happens, and restored on return
 * (docs/09, "Offline resilience").
 */
export default function SigningWorkspace({
  token,
  session,
  onEnd,
}: {
  token: string;
  session: SigningSession;
  onEnd: (state: EndState) => void;
}) {
  const fields = session.fields;
  const key = useMemo(() => draftKey(fields), [fields]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    key ? loadDraft(key, fields) : {},
  );
  const [restored, setRestored] = useState(() => Object.keys(values).length > 0);
  const [adopted, setAdopted] = useState<Adopted>(session.adopted);
  const [images, setImages] = useState(() => (key ? loadAdoptedImages(key) : {}));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  useDocumentTitle(session.envelopeTitle);

  useEffect(() => pruneDrafts(), []);
  useEffect(() => {
    if (key) saveDraft(key, values);
  }, [key, values]);

  const byPage = useMemo(() => {
    const pages = new Map<number, SigningField[]>();
    for (const field of fields) {
      pages.set(field.pageNumber, [...(pages.get(field.pageNumber) ?? []), field]);
    }
    return pages;
  }, [fields]);

  const today = useMemo(() => formatDate(new Date().toISOString()), []);

  /** Leaves for an end screen, forgetting the draft: this link has nothing more to do. */
  const finish = (state: EndState) => {
    if (key) clearDraft(key);
    onEnd(state);
  };

  const pdf = useQuery({
    queryKey: signingKeys.document(token),
    queryFn: () => signingApi.document(token),
    staleTime: Number.POSITIVE_INFINITY,
    retry: (failures, error) => failures < 2 && isTransient(error),
  });

  useEffect(() => {
    if (!pdf.error) return;
    const end = endStateFor(pdf.error);
    if (end) {
      if (key) clearDraft(key);
      onEnd(end);
    } else if (isTransient(pdf.error)) {
      reportError(pdf.error, 'signing:document');
    }
  }, [pdf.error, key, onEnd]);

  const setValue = (id: string, value: string | undefined) => {
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  };

  const progress = signingProgress(fields, values, adopted);
  const upcoming = nextField(fields, values, adopted, currentId);

  function goTo(field: SigningField) {
    setCurrentId(field.id);
    const element = document.querySelector<HTMLElement>(`[data-signing-field="${field.id}"]`);
    if (!element) return;
    const reduce = prefersReducedMotion();
    element.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
    element.focus({ preventScroll: true });
    if (!reduce && typeof element.animate === 'function') {
      element.animate(FLASH_KEYFRAMES, { duration: 1200, easing: 'ease-out' });
    }
  }

  function activate(field: SigningField) {
    setCurrentId(field.id);
    if (field.type === 'CHECKBOX') {
      setValue(field.id, values[field.id] === 'true' ? 'false' : 'true');
    } else if (field.type === 'TEXT_INPUT') {
      setSheet({ type: 'text', field });
    } else if (isSignatureKind(field.type)) {
      // Adopted already: tapping an empty box puts it there. Tapping a signed
      // box offers to change it.
      if (adopted[field.type] && values[field.id] !== SIGNED_MARK) {
        setValue(field.id, SIGNED_MARK);
      } else {
        setSheet({ type: 'adopt', kind: field.type, field });
      }
    }
  }

  function applyAdoption(adoption: Adoption, field: SigningField) {
    setAdopted((previous) => ({ ...previous, [adoption.kind]: adoption.method }));
    setImages((previous) => ({ ...previous, [adoption.kind]: adoption.image }));
    if (key) saveAdoptedImage(key, adoption.kind, adoption.image);
    setValue(field.id, SIGNED_MARK);
    setSheet(null);
  }

  const submit = useMutation({
    mutationFn: () =>
      withBackoff(() => signingApi.submit(token, toSubmission(fields, values, adopted))),
    onSuccess: (result) => finish({ kind: 'signed', message: result.message }),
    onError: (error) => {
      const end = endStateFor(error);
      if (end) {
        // TOKEN_ALREADY_USED after a retry means an earlier attempt got through.
        finish(end);
        return;
      }
      if (error instanceof ApiError && error.code === 'REQUIRED_FIELDS_INCOMPLETE') {
        const ids = new Set(
          error.fieldErrors.map((problem) => problem.path.replace(/^fields\./, '')),
        );
        setMissing(ids);
        // The server has no signature for these, whatever this page thought:
        // the next tap must adopt one again.
        const lost = fields.filter((field) => ids.has(field.id) && isSignatureKind(field.type));
        if (lost.length > 0) {
          setAdopted((previous) => {
            const next = { ...previous };
            for (const field of lost) delete next[field.type as SignatureKind];
            return next;
          });
        }
        const first = fields.find((field) => ids.has(field.id));
        if (first) goTo(first);
        return;
      }
      if (
        !(error instanceof ApiError) ||
        isTransient(error) ||
        error.code === 'VALIDATION_FAILED'
      ) {
        reportError(error, 'signing:submit');
      }
    },
  });

  const submitFailure =
    submit.error && !endStateFor(submit.error)
      ? submit.error instanceof ApiError && submit.error.code === 'REQUIRED_FIELDS_INCOMPLETE'
        ? { message: 'Some required boxes are still empty. They are marked in red.' }
        : describeError(submit.error)
      : null;

  const status = progress.complete
    ? progress.total === 0
      ? 'Nothing here is required. Fill in anything that applies, then finish.'
      : `All ${progress.total} required ${progress.total === 1 ? 'box is' : 'boxes are'} done.`
    : `${progress.done} of ${progress.total} required boxes done`;

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <header className="flex flex-none items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <LogoMark className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900">{session.envelopeTitle}</h1>
          <p className="truncate text-xs text-slate-500">From {session.senderName}</p>
        </div>
        <Button variant="ghost" className="shrink-0" onClick={() => setSheet({ type: 'decline' })}>
          Decline
        </Button>
      </header>

      {restored && (
        <div className="flex-none px-3 pt-2 sm:px-4">
          <Alert tone="info">
            <div className="flex items-center justify-between gap-3">
              <span>We restored what you filled in earlier on this device.</span>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-sm font-medium underline"
                onClick={() => setRestored(false)}
              >
                Dismiss
              </button>
            </div>
          </Alert>
        </div>
      )}

      <main className="relative min-h-0 flex-1" aria-label="Document">
        {pdf.data ? (
          <PdfViewer
            data={pdf.data}
            renderPageOverlay={(page) => (
              <SigningFieldLayer
                page={page}
                fields={byPage.get(page.pageNumber) ?? []}
                pageCount={session.pageCount}
                values={values}
                adopted={adopted}
                images={images}
                currentId={currentId}
                missing={missing}
                today={today}
                onActivate={activate}
              />
            )}
          />
        ) : pdf.isError ? (
          <div className="mx-auto max-w-md space-y-3 p-6 text-center">
            <Alert reference={describeError(pdf.error).reference}>
              {describeError(pdf.error).message}
            </Alert>
            <Button onClick={() => void pdf.refetch()} loading={pdf.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-brand-700">
            <Spinner className="h-8 w-8" label="Loading the document…" />
          </div>
        )}
      </main>

      <footer className="flex-none border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {submitFailure && (
            <Alert reference={submitFailure.reference}>{submitFailure.message}</Alert>
          )}
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-slate-700" aria-live="polite">
              {status}
            </p>
            {progress.complete ? (
              <Button
                className="min-h-11 shrink-0"
                loading={submit.isPending}
                disabled={!pdf.data}
                onClick={() => submit.mutate()}
              >
                {submit.isError && !submit.isPending ? 'Try again' : 'Finish'}
              </Button>
            ) : (
              <Button
                className="min-h-11 shrink-0"
                disabled={!pdf.data || upcoming === null}
                onClick={() => upcoming && goTo(upcoming)}
              >
                {upcoming && currentId !== null ? `Next: ${fieldTypeName(upcoming.type)}` : 'Start'}
              </Button>
            )}
          </div>
        </div>
      </footer>

      <AdoptSheet
        open={sheet?.type === 'adopt'}
        kind={sheet?.type === 'adopt' ? sheet.kind : 'SIGNATURE'}
        token={token}
        recipientName={session.recipientName}
        onRemove={
          sheet?.type === 'adopt' && !sheet.field.required && isFilled(sheet.field, values, adopted)
            ? () => {
                setValue(sheet.field.id, undefined);
                setSheet(null);
              }
            : undefined
        }
        onClose={() => setSheet(null)}
        onAdopted={(adoption) => {
          if (sheet?.type === 'adopt') applyAdoption(adoption, sheet.field);
        }}
        onEnd={finish}
      />

      <TextSheet
        field={sheet?.type === 'text' ? sheet.field : null}
        value={sheet?.type === 'text' ? (values[sheet.field.id] ?? '') : ''}
        pageCount={session.pageCount}
        onSave={(text) => {
          if (sheet?.type === 'text') setValue(sheet.field.id, text.trim() ? text : undefined);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />

      <DeclineDialog
        open={sheet?.type === 'decline'}
        token={token}
        senderName={session.senderName}
        onClose={() => setSheet(null)}
        onEnd={finish}
      />
    </div>
  );
}
