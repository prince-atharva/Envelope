import {
  type AddRecipientInput,
  canOwnFields,
  checkReadyToSend,
  type FieldInfo,
  type FieldType,
  type PageSize,
  type RecipientInfo,
  type RecipientRole,
} from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { type PageRenderInfo, PdfViewer, type PdfViewerHandle } from '../components/pdf/PdfViewer';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { builderReducer, initialBuilderState } from '../features/builder/builder-state';
import { FieldOverlay } from '../features/builder/FieldOverlay';
import { FieldPalette } from '../features/builder/FieldPalette';
import { RecipientPanel } from '../features/builder/RecipientPanel';
import { moveRecipient } from '../features/builder/recipient-order';
import { useAutosave } from '../features/builder/useAutosave';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/** Identifies one version of the layout as the server sees it. */
function layoutSignature(revision: number, fieldCount: number): string {
  return `${revision}:${fieldCount}`;
}

const SAVE_LABEL: Record<string, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
  conflict: 'Changed in another tab',
};

export function PreparePage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const viewerRef = useRef<PdfViewerHandle>(null);

  const [state, dispatch] = useReducer(builderReducer, initialBuilderState);
  const [armed, setArmed] = useState<FieldType | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  /** Page sizes in points, collected from pdf.js as each page reports itself. */
  const pagesRef = useRef(new Map<number, PageSize>());

  const envelopeQuery = useQuery({
    queryKey: queryKeys.envelope(id),
    queryFn: () => api.getEnvelope(id),
    enabled: id.length > 0,
  });
  const envelope = envelopeQuery.data;

  const pdfQuery = useQuery({
    queryKey: queryKeys.document(id, 0),
    queryFn: () => api.downloadDocument(id, 0),
    enabled: id.length > 0 && !!envelope,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useDocumentTitle(envelope ? `Prepare · ${envelope.title}` : 'Prepare');

  // What the builder has already taken from the server. A save writes its own
  // result here, so the effect below does not treat the answer to our own save
  // as someone else's change and reload over the top of it.
  const loadedRef = useRef<string | null>(null);

  const onSaved = useCallback(
    (fields: FieldInfo[], revision: number) => {
      loadedRef.current = layoutSignature(revision, fields.length);
      dispatch({ type: 'saved', fields });
      queryClient.setQueryData(queryKeys.envelope(id), (old: typeof envelope) =>
        old ? { ...old, fields, draftRevision: revision } : old,
      );
    },
    [id, queryClient],
  );

  const autosave = useAutosave(id, envelope?.draftRevision ?? 0, onSaved);

  // Loads the saved layout when the envelope first arrives, and again when the
  // server sends a different one back — after a recipient change, say.
  //
  // Reloading clears the selection, so doing it after our own save would
  // deselect the field the user is working on and stop the arrow keys mid-edit.
  useEffect(() => {
    if (!envelope) return;
    const signature = layoutSignature(envelope.draftRevision, envelope.fields.length);
    if (loadedRef.current === signature || state.dirty) return;
    loadedRef.current = signature;
    dispatch({ type: 'reset', fields: envelope.fields });
    if (!state.activeRecipientId) {
      const first = envelope.recipients.find((r) => canOwnFields(r.role));
      if (first) dispatch({ type: 'setActiveRecipient', recipientId: first.id });
    }
  }, [envelope, state.dirty, state.activeRecipientId]);

  // Every change is saved a second later; nothing has to be pressed.
  useEffect(() => {
    if (state.dirty) autosave.save(state.fields);
  }, [state.dirty, state.fields, autosave.save]);

  const recipientMutation = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.envelope(id) }),
  });

  const runRecipientChange = useCallback(
    async (run: () => Promise<unknown>) => {
      // Field edits are saved first: a recipient change bumps the draft
      // revision, which would otherwise make the pending layout save stale.
      if (state.dirty) await autosave.saveNow(state.fields);
      await recipientMutation.mutateAsync(run);
    },
    [autosave, recipientMutation, state.dirty, state.fields],
  );

  const fieldCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of state.fields) {
      counts.set(field.recipientId, (counts.get(field.recipientId) ?? 0) + 1);
    }
    return counts;
  }, [state.fields]);

  const issues = useMemo(
    () =>
      envelope ? checkReadyToSend({ recipients: envelope.recipients, fields: state.fields }) : [],
    [envelope, state.fields],
  );

  // Arrow keys nudge, Delete removes, Escape deselects. preventDefault also
  // tells the viewer to leave the key alone, so nudging does not turn the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (state.selection.length === 0) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      const direction = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }[event.key] as 'up' | 'down' | 'left' | 'right' | undefined;

      if (direction) {
        event.preventDefault();
        dispatch({
          type: 'nudgeSelection',
          direction,
          large: event.shiftKey,
          pages: pagesRef.current,
        });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        dispatch({ type: 'deleteSelection' });
      } else if (event.key === 'Escape') {
        dispatch({ type: 'clearSelection' });
        setArmed(null);
      }
    }
    // Capture phase on purpose. The viewer also listens for the arrow keys, to
    // turn the page, and it registers first because child effects run before
    // parent ones. A capture listener runs before any bubble listener whatever
    // the order, so `preventDefault` here reaches the viewer's check in time and
    // nudging a field no longer turns the page as well.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.selection.length]);

  const placeField = useCallback(
    (pageNumber: number, centrePt: { xPt: number; yPt: number }) => {
      const page = pagesRef.current.get(pageNumber);
      if (!armed || !page || !state.activeRecipientId) {
        dispatch({ type: 'clearSelection' });
        return;
      }
      dispatch({
        type: 'addField',
        id: crypto.randomUUID(),
        fieldType: armed,
        recipientId: state.activeRecipientId,
        pageNumber,
        page,
        centrePt,
      });
      setArmed(null);
    },
    [armed, state.activeRecipientId],
  );

  const renderPageOverlay = useCallback(
    (page: PageRenderInfo) => {
      pagesRef.current.set(page.pageNumber, {
        widthPt: page.widthPt,
        heightPt: page.heightPt,
      });
      return (
        <FieldOverlay
          page={page}
          fields={state.fields.filter((field) => field.pageNumber === page.pageNumber)}
          recipients={envelope?.recipients ?? []}
          selection={state.selection}
          dispatch={dispatch}
          onAddAt={placeField}
        />
      );
    },
    [envelope?.recipients, placeField, state.fields, state.selection],
  );

  if (envelopeQuery.isLoading) return <FullPageSpinner label="Loading document…" />;
  if (envelopeQuery.error) {
    const described = describeError(envelopeQuery.error);
    return <Alert reference={described.reference}>{described.message}</Alert>;
  }
  if (!envelope) return <Alert>This document could not be found.</Alert>;

  // Sent already: fields can no longer change, so show the progress instead.
  if (envelope.status !== 'DRAFT') {
    return <Navigate to={`/dashboard/envelopes/${envelope.id}`} replace />;
  }

  const selectedField = state.fields.find((field) => field.id === state.selection[0]);
  const signers = envelope.recipients.filter((r) => canOwnFields(r.role));

  return (
    <div className="flex flex-1 flex-col gap-3 min-h-0">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/dashboard/envelopes/${envelope.id}`}
            className="text-xs text-slate-500 hover:underline"
          >
            ← {envelope.title}
          </Link>
          <h1 className="truncate text-lg font-semibold text-slate-900">Prepare for signing</h1>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${autosave.state === 'error' || autosave.state === 'conflict' ? 'text-red-700' : 'text-slate-500'}`}
        >
          {SAVE_LABEL[autosave.state]}
        </p>
        <ButtonLink to={`/dashboard/envelopes/${envelope.id}/review`} variant="secondary">
          Review
        </ButtonLink>
      </header>

      {autosave.state === 'conflict' && (
        <Alert>
          This document was changed in another tab. Reload to see those changes; anything you have
          done here since will be lost.{' '}
          <Button
            variant="ghost"
            className="px-1 py-0 text-sm underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Alert>
      )}

      <div className="flex flex-1 flex-col gap-4 min-h-0 lg:flex-row">
        <aside className="w-full space-y-5 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-4 lg:w-72 lg:shrink-0">
          <RecipientPanel
            recipients={envelope.recipients}
            activeRecipientId={state.activeRecipientId}
            fieldCounts={fieldCounts}
            busy={recipientMutation.isPending}
            sequentialSigning={envelope.sequentialSigning}
            onSelect={(recipientId) => dispatch({ type: 'setActiveRecipient', recipientId })}
            onAdd={async (input: AddRecipientInput) => {
              await runRecipientChange(() => api.addRecipient(id, input));
            }}
            onChangeRole={async (recipient: RecipientInfo, role: RecipientRole) => {
              await runRecipientChange(() => api.updateRecipient(id, recipient.id, { role }));
              if (!canOwnFields(role)) {
                dispatch({ type: 'removeRecipientFields', recipientId: recipient.id });
              }
            }}
            onRemove={async (recipient: RecipientInfo) => {
              await runRecipientChange(() => api.removeRecipient(id, recipient.id));
              dispatch({ type: 'removeRecipientFields', recipientId: recipient.id });
            }}
            onMove={async (recipient: RecipientInfo, direction) => {
              const changes = moveRecipient(envelope.recipients, recipient.id, direction);
              await runRecipientChange(async () => {
                // One at a time: each request bumps the draft revision.
                for (const change of changes) {
                  await api.updateRecipient(id, change.recipientId, {
                    routingOrder: change.routingOrder,
                  });
                }
              });
            }}
            onToggleSequential={async (value) => {
              await runRecipientChange(() => api.updateEnvelope(id, { sequentialSigning: value }));
            }}
          />

          <FieldPalette
            armed={armed}
            onArm={setArmed}
            disabled={signers.length === 0 || !state.activeRecipientId}
          />

          {selectedField && (
            <section aria-labelledby="field-heading" className="space-y-2">
              <h2
                id="field-heading"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Selected field
              </h2>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(event) =>
                    dispatch({
                      type: 'setRequired',
                      id: selectedField.id,
                      required: event.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />
                Must be filled in
              </label>
              <Button
                variant="secondary"
                className="w-full text-sm"
                onClick={() =>
                  dispatch({
                    type: 'copyToAllPages',
                    id: selectedField.id,
                    pageCount: envelope.pageCount,
                    newIds: Array.from({ length: envelope.pageCount }, () => crypto.randomUUID()),
                  })
                }
              >
                Copy to every page
              </Button>
              <Button
                variant="ghost"
                className="w-full text-sm text-red-700"
                onClick={() => dispatch({ type: 'deleteSelection' })}
              >
                Delete field
              </Button>
            </section>
          )}

          {issues.length > 0 && (
            <section aria-labelledby="issues-heading" className="space-y-1">
              <h2
                id="issues-heading"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Before sending
              </h2>
              <ul className="space-y-1 text-xs text-amber-800">
                {issues.map((issue) => (
                  <li
                    key={`${issue.code}-${'recipientId' in issue ? issue.recipientId : 'fieldId' in issue ? issue.fieldId : ''}`}
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white">
          {pdfQuery.data ? (
            <PdfViewer
              ref={viewerRef}
              data={pdfQuery.data}
              className="h-full w-full"
              renderPageOverlay={renderPageOverlay}
              onPageChange={setCurrentPage}
            />
          ) : (
            <FullPageSpinner label="Loading pages…" />
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        Page {currentPage} of {envelope.pageCount}. {state.fields.length} fields placed.
      </p>
    </div>
  );
}
