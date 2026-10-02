import {
  type AuditEventInfo,
  type DocumentVersionInfo,
  type EnvelopeDetail,
  hasAtLeast,
  isOpenEnvelope,
} from '@envelope/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { PdfViewer } from '../components/pdf/PdfViewer';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { HashBlock } from '../components/ui/HashBlock';
import { ArrowRightIcon, TrashIcon } from '../components/ui/icons';
import { EnvelopeDetailSkeleton } from '../components/ui/Skeletons';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { isView } from '../features/dashboard/dashboard';
import { CancelDialog } from '../features/envelope/CancelDialog';
import { CancelledBanner } from '../features/envelope/CancelledBanner';
import { CompletionBanner } from '../features/envelope/CompletionBanner';
import { cancelModeFor } from '../features/envelope/cancel';
import { downloadName } from '../features/envelope/document-files';
import { ExpiredBanner } from '../features/envelope/ExpiredBanner';
import { ExtendDialog } from '../features/envelope/ExtendDialog';
import { envelopeEventsQuery } from '../features/envelope/events-query';
import { canExtend } from '../features/envelope/extend';
import { LegalHoldBanner } from '../features/envelope/LegalHoldBanner';
import { LegalHoldDialog } from '../features/envelope/LegalHoldDialog';
import { PartnerReference } from '../features/envelope/PartnerReference';
import { RecipientProgress } from '../features/sending/RecipientProgress';
import type { SentState } from '../features/sending/SendDialog';
import { canSaveAsTemplate, SaveTemplateDialog } from '../features/templates/SaveTemplateDialog';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import {
  describeAuditAction,
  formatBytes,
  formatDate,
  formatDateTime,
  shortHash,
} from '../lib/format';
import { roleNoun } from '../lib/labels';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/** While people are signing, the page checks for progress this often. */
const PROGRESS_REFRESH_MS = 15_000;
/** The completion emails go out just after sealing: keep checking this long for them. */
const AFTER_COMPLETION_MS = 2 * 60_000;

function stillChanging(envelope: EnvelopeDetail | undefined): boolean {
  if (!envelope) return false;
  if (isOpenEnvelope(envelope.status)) return true;
  return (
    envelope.status === 'COMPLETED' &&
    !!envelope.completedAt &&
    Date.now() - new Date(envelope.completedAt).getTime() < AFTER_COMPLETION_MS
  );
}

export function EnvelopeDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const location = useLocation();
  const [cancelling, setCancelling] = useState(false);
  const [extending, setExtending] = useState(false);
  const [placingHold, setPlacingHold] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const { user } = useAuth();
  const isAdmin = !!user && hasAtLeast(user.role, 'ADMIN');
  const queryClient = useQueryClient();
  const [activityTab, setActivityTab] = useState<'audit' | 'versions'>('audit');
  const activityTabsId = useId();
  const sent = (location.state as SentState | null)?.sentTo;
  // The dashboard tab this was opened from, so Back returns to it. History state
  // can hold anything, so it is checked before it goes into a URL.
  const fromView = (location.state as { fromView?: unknown } | null)?.fromView;
  const backTo = isView(fromView) ? `/dashboard?view=${fromView}` : '/dashboard';

  const {
    data: envelope,
    isLoading: isLoadingEnvelope,
    error: envelopeError,
  } = useQuery({
    queryKey: queryKeys.envelope(id),
    queryFn: () => api.getEnvelope(id),
    enabled: id.length > 0,
    refetchInterval: (query) => (stillChanging(query.state.data) ? PROGRESS_REFRESH_MS : false),
  });

  // Only ever the events past what the detail already carries: never runs
  // until the detail says there are more (100M-row scale follow-up web
  // pass, docs/16 step 14).
  const moreEvents = useInfiniteQuery({
    ...envelopeEventsQuery(id, envelope?.eventsCursor ?? ''),
    enabled: !!envelope?.eventsCursor,
  });
  const auditTrail = [
    ...(envelope?.auditTrail ?? []),
    ...(moreEvents.data?.pages.flatMap((page) => page.items) ?? []),
  ];

  // The newest version: the signatures so far while people sign, then the
  // sealed document with its certificate (ADR 0003).
  const latest = envelope?.versions.at(-1);
  const shownVersion = latest?.versionNumber ?? 0;
  const {
    data: pdfData,
    isLoading: isLoadingPdf,
    error: pdfError,
  } = useQuery({
    queryKey: queryKeys.document(id, shownVersion),
    queryFn: () => api.downloadDocument(id, shownVersion),
    enabled: id.length > 0 && !!envelope,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useDocumentTitle(envelope?.title);

  const releaseHoldMutation = useMutation({
    mutationFn: () => api.releaseLegalHold(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.envelope(id) }),
  });

  async function exportAudit(format: 'json' | 'csv') {
    const blob = await api.auditExport(id, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${id}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const signerName = (recipientId: string) =>
    envelope?.recipients.find((r) => r.id === recipientId)?.name ?? 'a recipient';

  // A signer who passed their part on shows in the progress list, not as a second person here (docs/22).
  const setupRecipients = (envelope?.recipients ?? []).filter((r) => r.status !== 'DELEGATED');

  const handleDownload = () => {
    if (pdfData && envelope) {
      const blob = new Blob([pdfData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(
        envelope.originalFilename,
        latest ?? { versionNumber: 0, isFinal: false },
      );
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  };

  const sealedHash = envelope?.status === 'COMPLETED' ? envelope.finalHash : null;

  if (isLoadingEnvelope) {
    return <EnvelopeDetailSkeleton />;
  }

  if (envelopeError) {
    const err = describeError(envelopeError);
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Alert reference={err.reference}>{err.message}</Alert>
      </div>
    );
  }

  if (!envelope) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Alert>The requested document could not be found.</Alert>
      </div>
    );
  }

  return (
    <div className="page-stack flex-1">
      {/* 1. Header Bar: Breadcrumb, Title, Status & Actions */}
      <div className="page-heading">
        <div className="min-w-0 flex-1 basis-80 space-y-3">
          {/* Back link */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link
              to={backTo}
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
              <span>Back to documents</span>
            </Link>
          </div>

          {/* Title & Status Badge */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="page-title" title={envelope.title}>
              {envelope.title}
            </h1>
            <StatusBadge status={envelope.status} />
            {latest && latest.versionNumber > 0 && (
              <span
                className="text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200/80 px-2.5 py-0.5 rounded-full shrink-0 inline-flex items-center gap-1.5"
                data-testid="shown-version"
              >
                <span>v{latest.versionNumber}</span>
                <span className="font-normal text-brand-700">
                  {latest.isFinal ? '(the sealed document)' : '(signatures in progress)'}
                </span>
              </span>
            )}
          </div>

          {/* Metadata details */}
          {/* Spaced rather than bullet-separated: when the line wraps, a
              bullet was left dangling at the end of a line or the start of the next. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="whitespace-nowrap">
              {envelope.pageCount} {envelope.pageCount === 1 ? 'page' : 'pages'}
            </span>
            <span>
              Created by{' '}
              <strong className="font-medium text-slate-700">{envelope.owner.fullName}</strong> on{' '}
              <span className="whitespace-nowrap">{formatDateTime(envelope.createdAt)}</span>
            </span>
            {envelope.expiresAt && isOpenEnvelope(envelope.status) && (
              <span className="whitespace-nowrap font-medium text-amber-800">
                Due {formatDate(envelope.expiresAt)}
              </span>
            )}
            <PartnerReference externalId={envelope.externalId} metadata={envelope.metadata} />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 lg:justify-end max-sm:[&>a]:grow max-sm:[&>button]:grow">
          {/* An expired envelope offers both choices in its banner instead. */}
          {cancelModeFor(envelope.status) && envelope.status !== 'EXPIRED' && (
            <Button
              variant="dangerOutline"
              size="sm"
              onClick={() => setCancelling(true)}
              title={
                cancelModeFor(envelope.status) === 'discard'
                  ? 'Discard this draft'
                  : 'Cancel this document'
              }
            >
              <TrashIcon className="h-4 w-4" />
              {cancelModeFor(envelope.status) === 'discard' ? 'Discard draft' : 'Cancel document'}
            </Button>
          )}

          {canExtend(envelope.status) && envelope.status !== 'EXPIRED' && (
            <Button size="sm" onClick={() => setExtending(true)} variant="secondary">
              Give more time
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleDownload}
            disabled={!pdfData}
            variant={envelope.status === 'COMPLETED' ? 'primary' : 'secondary'}
            className="inline-flex items-center gap-1.5"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>
              {envelope.status === 'COMPLETED' ? 'Download signed document' : 'Download PDF'}
            </span>
          </Button>

          {isAdmin && !envelope.legalHoldAt && (
            <Button size="sm" variant="secondary" onClick={() => setPlacingHold(true)}>
              Legal hold
            </Button>
          )}

          {isAdmin && canSaveAsTemplate(envelope) && (
            <Button size="sm" variant="secondary" onClick={() => setSavingTemplate(true)}>
              Save as template
            </Button>
          )}

          {envelope.status === 'DRAFT' && (
            <ButtonLink
              size="sm"
              to={`/dashboard/envelopes/${envelope.id}/prepare`}
              variant="primary"
              className="inline-flex items-center gap-1.5"
            >
              <span>Prepare for signing</span>
              <ArrowRightIcon className="h-4 w-4" />
            </ButtonLink>
          )}
        </div>
      </div>

      {/* 2. Dialog Modals */}
      {canExtend(envelope.status) && (
        <ExtendDialog envelope={envelope} open={extending} onClose={() => setExtending(false)} />
      )}
      <CancelDialog envelope={envelope} open={cancelling} onClose={() => setCancelling(false)} />
      {isAdmin && canSaveAsTemplate(envelope) && (
        <SaveTemplateDialog
          envelope={envelope}
          open={savingTemplate}
          onClose={() => setSavingTemplate(false)}
        />
      )}
      {isAdmin && (
        <LegalHoldDialog
          envelope={envelope}
          open={placingHold}
          onClose={() => setPlacingHold(false)}
        />
      )}

      {/* Status banners, full width above the document */}
      {sent && isOpenEnvelope(envelope.status) && (
        <Alert tone="success">Sent. We are emailing {sent} a link to sign.</Alert>
      )}
      <LegalHoldBanner
        envelope={envelope}
        onRelease={isAdmin ? () => releaseHoldMutation.mutate() : undefined}
        releasing={releaseHoldMutation.isPending}
      />
      <CompletionBanner envelope={envelope} />
      <CancelledBanner envelope={envelope} />
      <ExpiredBanner
        envelope={envelope}
        onExtend={() => setExtending(true)}
        onCancel={() => setCancelling(true)}
      />

      {/* 3. The document, with its people, fingerprint and history beside it */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* On a wide screen the document stays in view, one screen tall, while
            the sidebar scrolls past it: a fixed-height viewer left a large empty
            column beside a long audit trail. */}
        <div className="min-w-0 xl:col-span-8 xl:sticky xl:top-20">
          <div className="surface overflow-hidden flex flex-col h-[70vh] min-h-112 lg:h-[calc(100dvh-6.5rem)]">
            {/* Live PDF Canvas */}
            {isLoadingPdf ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/60 p-8">
                <div className="h-10 w-10 rounded-full bg-slate-200/80 animate-pulse mb-3" />
                <div className="h-3.5 w-44 rounded bg-slate-200/70 animate-pulse" />
              </div>
            ) : pdfError ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
                <div className="w-12 h-12 rounded-full bg-red-50 text-red-500 border border-red-200/60 flex items-center justify-center mb-3">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                  Failed to load document
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mb-4">
                  The document file could not be retrieved from the server.
                </p>
              </div>
            ) : pdfData ? (
              <PdfViewer data={pdfData} className="h-full w-full" />
            ) : (
              <div className="flex-1 flex items-center justify-center bg-slate-50">
                <span className="text-slate-500 text-sm">Preview not available</span>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: people, fingerprint, history */}
        <div className="min-w-0 xl:col-span-4 flex flex-col space-y-5">
          {/* Section 1A: Signers & Workflow for Draft */}
          {envelope.status === 'DRAFT' && (
            <Card className="space-y-3.5">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-brand-50 text-brand-700 border border-brand-200/70 flex items-center justify-center shrink-0">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                      />
                    </svg>
                  </div>
                  <h2 className="section-title">Signers & Setup</h2>
                </div>
                <span className="text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200/60 px-2 py-0.5 whitespace-nowrap rounded-full">
                  {setupRecipients.length} {setupRecipients.length === 1 ? 'person' : 'people'}
                </span>
              </div>

              {setupRecipients.length > 0 ? (
                <div className="space-y-2">
                  {setupRecipients.map((recipient, idx) => (
                    <div
                      key={recipient.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 text-xs min-w-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-800 font-bold text-xs flex items-center justify-center shrink-0">
                          {recipient.routingOrder || idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{recipient.name}</p>
                          <p className="text-xs text-slate-600 truncate">{recipient.email}</p>
                        </div>
                      </div>
                      <span className="text-xs capitalize font-medium text-brand-700 bg-brand-50 border border-brand-200/70 px-2 py-0.5 whitespace-nowrap rounded-full shrink-0">
                        {roleNoun(recipient.role)}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1">
                    <ButtonLink
                      size="sm"
                      to={`/dashboard/envelopes/${envelope.id}/prepare`}
                      variant="secondary"
                      className="w-full justify-center"
                    >
                      Edit signers & fields
                    </ButtonLink>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center space-y-1.5">
                  <div className="mx-auto w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-1">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.765z"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold text-slate-800">No signers added yet</p>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Use the <strong>Prepare for signing</strong> button above to add recipients and
                    place signature fields.
                  </p>
                </div>
              )}
            </Card>
          )}

          {/* Section 1B: Signers Progress when Sent */}
          {envelope.sentAt && <RecipientProgress envelope={envelope} />}

          {/* Section 2: Cryptographic Security & SHA-256 Seal */}
          <Card className="space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center shrink-0">
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <h2 className="section-title">Tamper-evident security</h2>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                SHA-256
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {sealedHash
                ? 'Fingerprint of the sealed document. Anyone can check a copy against it.'
                : 'Fingerprint of the document as it was uploaded.'}
            </p>

            {sealedHash ? (
              <HashBlock hash={sealedHash} status="Sealed" testId="final-hash" />
            ) : (
              <HashBlock hash={envelope.originalHash} testId="original-hash" />
            )}

            {sealedHash && (
              <p className="text-xs text-slate-600 font-mono" title={envelope.originalHash}>
                <span className="text-slate-500 font-sans">Original upload: </span>
                <span className="text-slate-700 font-semibold">
                  {shortHash(envelope.originalHash)}
                </span>
              </p>
            )}

            <div className="pt-2 text-center border-t border-slate-100">
              <Link
                to="/verify"
                className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline inline-flex items-center gap-1.5"
              >
                <span>Verify authenticity & certificate</span>
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </Card>

          {/* Section 3: Tabbed Activity & History (Audit Trail & Document Versions) */}
          <div className="surface overflow-hidden flex flex-col">
            <Tabs
              idPrefix={activityTabsId}
              label="Document history"
              variant="underline"
              value={activityTab}
              onChange={setActivityTab}
              className="border-b border-slate-200 bg-slate-50/70 px-4 pt-3"
              items={[
                { id: 'audit', label: 'Audit trail', count: envelope.auditEventCount },
                { id: 'versions', label: 'Versions', count: envelope.versions.length },
              ]}
            />

            {isAdmin && activityTab === 'audit' && (
              <div className="flex justify-end gap-2 border-b border-slate-100 px-4 py-2">
                <Button variant="secondary" size="sm" onClick={() => void exportAudit('json')}>
                  Export JSON
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void exportAudit('csv')}>
                  Export CSV
                </Button>
              </div>
            )}

            {/* Tab 1: Audit Trail */}
            <TabPanel
              idPrefix={activityTabsId}
              id="audit"
              hidden={activityTab !== 'audit'}
              className="max-h-100 overflow-y-auto overflow-x-hidden p-4"
            >
              {auditTrail.length > 0 ? (
                <div className="relative pl-7 space-y-3 min-w-0 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {auditTrail.map((event: AuditEventInfo) => (
                    <div key={event.sequence} className="relative min-w-0">
                      <div className="absolute -left-7 top-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-brand-600 bg-white px-0.5 text-[0.625rem] font-bold text-brand-700 shadow-xs">
                        {event.sequence}
                      </div>
                      <div className="min-w-0 bg-slate-50/90 border border-slate-200/90 rounded-lg p-2.5 text-xs hover:bg-slate-100 transition-colors">
                        {/* The event name wraps rather than truncating: "Document
                            uploaded and fi…" hid what happened. */}
                        <p className="font-semibold text-slate-900">
                          {describeAuditAction(event.action)}
                        </p>
                        <p className="mt-0.5 text-slate-500">{formatDateTime(event.timestamp)}</p>
                        <p
                          className="font-mono text-xs text-slate-600 mt-1 truncate block"
                          title={event.eventHash}
                        >
                          <span className="text-slate-500 font-sans font-medium">Hash: </span>
                          {event.eventHash}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-6 text-center">No audit events recorded.</p>
              )}
              {moreEvents.hasNextPage && (
                <div className="flex justify-center pt-3">
                  <Button
                    variant="secondary"
                    loading={moreEvents.isFetchingNextPage}
                    onClick={() => void moreEvents.fetchNextPage()}
                  >
                    Load more events
                  </Button>
                </div>
              )}
            </TabPanel>

            {/* Tab 2: Document Versions */}
            <TabPanel
              idPrefix={activityTabsId}
              id="versions"
              hidden={activityTab !== 'versions'}
              className="max-h-100 overflow-y-auto overflow-x-hidden p-4"
            >
              {envelope.versions.length > 0 ? (
                <div className="space-y-2.5 min-w-0">
                  {envelope.versions.map((version: DocumentVersionInfo) => (
                    <div
                      key={version.versionNumber}
                      className="p-3 bg-slate-50/90 border border-slate-200/90 rounded-xl text-xs space-y-1.5 hover:bg-slate-100 transition-all min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-bold text-slate-900">v{version.versionNumber}</span>
                          {version.isFinal ? (
                            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 whitespace-nowrap rounded-full border border-emerald-200">
                              Sealed Final
                            </span>
                          ) : (
                            <span className="text-xs bg-slate-200 text-slate-800 font-semibold px-2 py-0.5 whitespace-nowrap rounded-full">
                              {version.versionNumber === 0 ? 'Original' : 'Signed'}
                            </span>
                          )}
                        </div>
                        <span className="text-slate-500 text-xs font-medium shrink-0">
                          {formatDateTime(version.createdAt)}
                        </span>
                      </div>

                      <p className="text-slate-700 text-xs font-medium truncate">
                        {version.isFinal
                          ? 'Certificate added, sealed and locked'
                          : version.createdByRecipientId
                            ? `Signed by ${signerName(version.createdByRecipientId)}`
                            : 'As uploaded'}
                      </p>

                      <div className="flex items-center justify-between text-slate-600 text-xs pt-1.5 border-t border-slate-200/70 gap-2 min-w-0">
                        <span className="shrink-0 font-medium">
                          {formatBytes(version.sizeBytes)} • {version.pageCount} pages
                        </span>
                        <span
                          className="font-mono text-slate-600 font-medium truncate"
                          title={version.sha256}
                        >
                          {shortHash(version.sha256)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-6 text-center">No versions recorded.</p>
              )}
            </TabPanel>
          </div>
        </div>
      </div>
    </div>
  );
}
