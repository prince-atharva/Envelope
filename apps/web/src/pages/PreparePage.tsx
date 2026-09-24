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
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { type PageRenderInfo, PdfViewer, type PdfViewerHandle } from '../components/pdf/PdfViewer';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { ArrowRightIcon } from '../components/ui/icons';
import { PreparePageSkeleton } from '../components/ui/Skeletons';
import { Spinner } from '../components/ui/Spinner';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { builderReducer, initialBuilderState } from '../features/builder/builder-state';
import { FieldOverlay } from '../features/builder/FieldOverlay';
import { FieldPalette } from '../features/builder/FieldPalette';
import { RecipientPanel } from '../features/builder/RecipientPanel';
import { moveRecipient } from '../features/builder/recipient-order';
import { useAutosave } from '../features/builder/useAutosave';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { FIELD_LABEL, roleNoun } from '../lib/labels';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/** Identifies one version of the layout as the server sees it. */
function layoutSignature(revision: number, fieldCount: number): string {
  return `${revision}:${fieldCount}`;
}

const SAVE_LABEL: Record<string, string> = {
  idle: 'Saved',
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
  const [sidebarTab, setSidebarTab] = useState<'fields' | 'recipients' | null>(null);
  const sidebarTabsId = useId();
  const checklistId = useId();
  const inspectorId = useId();
  const assigneeId = useId();
  /** Page sizes in points, collected from pdf.js as each page reports itself. */
  const pagesRef = useRef(new Map<number, PageSize>());
  const viewerCardRef = useRef<HTMLDivElement>(null);

  const envelopeQuery = useQuery({
    queryKey: queryKeys.envelope(id),
    queryFn: () => api.getEnvelope(id),
    enabled: id.length > 0,
  });
  const envelope = envelopeQuery.data;

  // Fields cannot be placed until somebody is there to sign them, so a document
  // with no recipients opens on Signers rather than on a palette that is
  // disabled and a canvas that ignores clicks. Once chosen, the sender's own
  // choice stands.
  const panel: 'fields' | 'recipients' =
    sidebarTab ?? (envelope && envelope.recipients.length === 0 ? 'recipients' : 'fields');

  // Always version 0, so it never needs the detail first: gating it on
  // `envelope` was an avoidable waterfall (100M-row scale follow-up web
  // pass, docs/16 step 14).
  const pdfQuery = useQuery({
    queryKey: queryKeys.document(id, 0),
    queryFn: () => api.downloadDocument(id, 0),
    enabled: id.length > 0,
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

  // Escape disarms the palette, or else deselects. Arrow keys nudge and Delete
  // removes. preventDefault also tells the viewer to leave the key alone, so
  // nudging does not turn the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (state.selection.length === 0 && !armed) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (armed) {
          setArmed(null);
        } else {
          dispatch({ type: 'clearSelection' });
        }
        return;
      }

      if (state.selection.length === 0) return;

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
      }
    }
    // Capture phase on purpose. The viewer also listens for the arrow keys, to
    // turn the page, and it registers first because child effects run before
    // parent ones. A capture listener runs before any bubble listener whatever
    // the order, so `preventDefault` here reaches the viewer's check in time and
    // nudging a field no longer turns the page as well.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.selection.length, armed]);

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

  if (envelopeQuery.isLoading) return <PreparePageSkeleton />;
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
  const activeRecipient = envelope.recipients.find((r) => r.id === state.activeRecipientId);
  const readyToSend = issues.length === 0 && state.fields.length > 0;

  return (
    <div className="flex flex-1 flex-col space-y-4 max-w-7xl mx-auto w-full pb-10 min-h-0">
      {/* 1. Header Bar: Breadcrumb, Step Badge, Title, Autosave & Action CTAs */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between bg-white border border-slate-200/90 rounded-2xl p-4 sm:px-6 sm:py-4 shadow-xs">
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Back link */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link
              to={`/dashboard/envelopes/${envelope.id}`}
              className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to document details</span>
            </Link>
          </div>

          {/* Title, Step Badge & Metadata */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Prepare for signing
            </h1>
            <span className="text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200/80 px-2.5 py-0.5 whitespace-nowrap rounded-full shrink-0 inline-flex items-center gap-1">
              <span>Step 2: Place fields</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="max-w-xs truncate font-medium text-slate-700" title={envelope.title}>
              {envelope.title}
            </span>
            <span>
              {envelope.pageCount} {envelope.pageCount === 1 ? 'page' : 'pages'}
            </span>
            <span>
              {envelope.recipients.length} {envelope.recipients.length === 1 ? 'person' : 'people'}
            </span>
            <span>
              {state.fields.length} {state.fields.length === 1 ? 'field placed' : 'fields placed'}
            </span>
          </div>
        </div>

        {/* Status Pill & Action CTAs */}
        <div className="flex flex-wrap items-center gap-2.5 lg:shrink-0 lg:justify-end max-sm:[&>a]:grow max-sm:[&>button]:grow">
          {/* Live Autosave Status Badge */}
          <div
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border bg-slate-50/80 border-slate-200/90 text-slate-600 shadow-2xs"
          >
            {autosave.state === 'saving' ? (
              <>
                <Spinner className="h-3.5 w-3.5 text-brand-600" />
                <span className="font-semibold text-slate-700">{SAVE_LABEL.saving}</span>
              </>
            ) : autosave.state === 'error' || autosave.state === 'conflict' ? (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-red-700 font-semibold">{SAVE_LABEL[autosave.state]}</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>{SAVE_LABEL[autosave.state] ?? SAVE_LABEL.saved}</span>
              </>
            )}
          </div>

          <ButtonLink
            to={`/dashboard/envelopes/${envelope.id}`}
            variant="secondary"
            size="sm"
            className="shadow-2xs"
          >
            Save and exit
          </ButtonLink>

          <ButtonLink
            to={`/dashboard/envelopes/${envelope.id}/review`}
            variant="primary"
            className="text-xs py-2 px-4 shadow-2xs inline-flex items-center gap-1.5"
          >
            <span>Continue to review</span>
            <ArrowRightIcon className="h-4 w-4" />
          </ButtonLink>
        </div>
      </div>

      {/* Conflict Alert if modified elsewhere */}
      {autosave.state === 'conflict' && (
        <Alert>
          This document was changed in another tab. Reload to see those changes; anything you have
          done here since will be lost.{' '}
          <Button
            variant="ghost"
            className="px-1.5 py-0.5 text-xs font-bold underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Alert>
      )}

      {/* 2. Sidebar and document */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start flex-1 min-h-0">
        {/* Left Sidebar: 4 cols on lg, 3.5 on xl */}
        <aside className="lg:col-span-4 xl:col-span-4 flex flex-col space-y-4 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs overflow-hidden">
          <Tabs
            idPrefix={sidebarTabsId}
            label="Prepare panels"
            variant="segmented"
            value={panel}
            onChange={setSidebarTab}
            items={[
              { id: 'fields', label: 'Fields & tools', count: state.fields.length },
              { id: 'recipients', label: 'Signers & order', count: envelope.recipients.length },
            ]}
          />

          {/* Tab 1: Fields & Tools */}
          <TabPanel
            idPrefix={sidebarTabsId}
            id="fields"
            hidden={panel !== 'fields'}
            className="space-y-4"
          >
            {/* Contextual Field Inspector: Displayed prominently when a field is selected */}
            {selectedField && (
              <section
                aria-labelledby={inspectorId}
                className="rounded-xl border-2 border-brand-500/40 bg-brand-50/20 p-3.5 space-y-3 shadow-2xs animate-fade-in"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-brand-200/50">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-brand-600" />
                    <h2
                      id={inspectorId}
                      className="text-xs font-bold uppercase tracking-wider text-slate-900"
                    >
                      Selected: {FIELD_LABEL[selectedField.type]}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'clearSelection' })}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Deselect
                  </button>
                </div>

                {/* Reassign Recipient Dropdown */}
                <div className="space-y-1">
                  <label
                    htmlFor={assigneeId}
                    className="block text-xs font-bold text-slate-700 uppercase tracking-wide"
                  >
                    Assignee
                  </label>
                  <select
                    id={assigneeId}
                    value={selectedField.recipientId}
                    onChange={(e) =>
                      dispatch({ type: 'assignSelection', recipientId: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs focus:border-brand-600 focus:outline-none cursor-pointer"
                  >
                    {signers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({roleNoun(r.role)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Required Switch */}
                <label className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200/90 text-xs font-semibold text-slate-800 cursor-pointer shadow-2xs">
                  <span>Must be filled in</span>
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
                    className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                </label>

                {/* Quick Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    variant="secondary"
                    className="text-xs py-1.5 px-2.5 justify-center shadow-2xs"
                    onClick={() =>
                      dispatch({
                        type: 'copyToAllPages',
                        id: selectedField.id,
                        pageCount: envelope.pageCount,
                        newIds: Array.from({ length: envelope.pageCount }, () =>
                          crypto.randomUUID(),
                        ),
                      })
                    }
                  >
                    Copy to all pages
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-xs py-1.5 px-2.5 justify-center text-red-700 hover:bg-red-50 hover:text-red-800 border border-red-200/80 shadow-2xs"
                    onClick={() => dispatch({ type: 'deleteSelection' })}
                  >
                    Delete field
                  </Button>
                </div>
              </section>
            )}

            {/* Field Palette */}
            <FieldPalette
              armed={armed}
              onArm={(type) => {
                setArmed(type);
                // On a phone the document sits below this panel: bring it up,
                // so the tap that places the field is not a scroll away.
                if (type && !window.matchMedia('(min-width: 1024px)').matches) {
                  viewerCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              disabled={signers.length === 0 || !state.activeRecipientId}
              recipients={signers}
              activeRecipientId={state.activeRecipientId}
              onSelectRecipient={(recipientId) =>
                dispatch({ type: 'setActiveRecipient', recipientId })
              }
            />
          </TabPanel>

          {/* Tab 2: Signers & Order */}
          <TabPanel idPrefix={sidebarTabsId} id="recipients" hidden={panel !== 'recipients'}>
            <RecipientPanel
              recipients={envelope.recipients}
              activeRecipientId={state.activeRecipientId}
              fieldCounts={fieldCounts}
              busy={recipientMutation.isPending}
              sequentialSigning={envelope.sequentialSigning}
              onSelect={(recipientId) => dispatch({ type: 'setActiveRecipient', recipientId })}
              onAdd={async (input: AddRecipientInput) => {
                // Pin the panel that is open. Left to the default, it flips to
                // Fields the moment the first person exists, hiding this form
                // from a sender about to add a second.
                setSidebarTab((tab) => tab ?? 'recipients');
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
                  for (const change of changes) {
                    await api.updateRecipient(id, change.recipientId, {
                      routingOrder: change.routingOrder,
                    });
                  }
                });
              }}
              onToggleSequential={async (value) => {
                await runRecipientChange(() =>
                  api.updateEnvelope(id, { sequentialSigning: value }),
                );
              }}
            />
          </TabPanel>

          {/* Pre-flight Checklist ("Before sending") */}
          <section
            aria-labelledby={checklistId}
            className="pt-3 border-t border-slate-100 space-y-2"
          >
            <div className="flex items-center justify-between">
              <h2
                id={checklistId}
                className="text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                Before sending
              </h2>
              {readyToSend ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 whitespace-nowrap rounded-full border border-emerald-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Ready to send
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 whitespace-nowrap rounded-full border border-amber-200/60">
                  {issues.length > 0
                    ? `${issues.length} item${issues.length === 1 ? '' : 's'} remaining`
                    : 'Needs a field'}
                </span>
              )}
            </div>

            {issues.length > 0 ? (
              <ul className="space-y-1.5 rounded-xl border border-amber-200/70 bg-amber-50/50 p-2.5 text-xs text-amber-800">
                {issues.map((issue) => (
                  <li
                    key={`${issue.code}-${'recipientId' in issue ? issue.recipientId : 'fieldId' in issue ? issue.fieldId : ''}`}
                    className="flex items-start gap-1.5"
                  >
                    <span className="mt-0.5 text-amber-600 font-bold">•</span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : state.fields.length === 0 ? (
              <p className="text-xs text-slate-500 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
                Add at least one signature field to the document to continue.
              </p>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-800">
                <svg
                  className="h-4 w-4 text-emerald-600 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Everyone who signs has a field. Ready to review.</span>
              </div>
            )}
          </section>

          {/* Keyboard hints, only where there is a keyboard-and-mouse pointer. */}
          <div className="hidden pointer-fine:block pt-2 border-t border-slate-100 text-xs text-slate-400 space-y-0.5">
            <p>
              <strong className="font-semibold text-slate-600">Tip:</strong> Use arrow keys to nudge
              selected fields, <kbd className="font-mono text-xs">Del</kbd> to delete, or{' '}
              <kbd className="font-mono text-xs">Esc</kbd> to deselect.
            </p>
          </div>
        </aside>

        {/* Center Stage: PDF Canvas with Overlays */}
        <div
          ref={viewerCardRef}
          className="scroll-mt-28 lg:col-span-8 xl:col-span-8 relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs h-[80vh] max-h-230 sm:min-h-165"
        >
          {/* What the next click does. One line on any screen: centred and
              wrapping, it grew into a block that covered the page on a phone. */}
          {armed && (
            <div className="pointer-events-none absolute inset-x-2 top-13 z-20 flex select-none items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/95 py-1.5 pr-1.5 pl-3 text-xs text-white shadow-lg backdrop-blur-md animate-slide-from-top sm:inset-x-auto sm:left-1/2 sm:max-w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:rounded-full">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">
                Tap the page to place <strong className="font-bold">{FIELD_LABEL[armed]}</strong>
                {activeRecipient && (
                  <>
                    {' '}
                    for{' '}
                    <strong className="font-bold text-emerald-300">{activeRecipient.name}</strong>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setArmed(null)}
                className="pointer-events-auto min-h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
              >
                Cancel<span className="hidden pointer-fine:inline"> (Esc)</span>
              </button>
            </div>
          )}

          {pdfQuery.data ? (
            <PdfViewer
              ref={viewerRef}
              data={pdfQuery.data}
              className="h-full w-full"
              renderPageOverlay={renderPageOverlay}
              onPageChange={setCurrentPage}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/60 p-8">
              <div className="h-10 w-10 rounded-full bg-slate-200/80 animate-pulse mb-3" />
              <div className="h-3.5 w-44 rounded bg-slate-200/70 animate-pulse" />
            </div>
          )}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        Page {currentPage} of {envelope.pageCount}. {state.fields.length} fields placed.
      </p>
    </div>
  );
}
