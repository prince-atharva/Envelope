import {
  type AuditEventInfo,
  type DocumentVersionInfo,
  type EnvelopeDetail,
  isOpenEnvelope,
} from '@envelope/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { PdfViewer } from '../components/pdf/PdfViewer';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { StatusBadge } from '../components/ui/StatusBadge';
import { CancelDialog } from '../features/envelope/CancelDialog';
import { CancelledBanner } from '../features/envelope/CancelledBanner';
import { CompletionBanner } from '../features/envelope/CompletionBanner';
import { cancelModeFor } from '../features/envelope/cancel';
import { downloadName } from '../features/envelope/document-files';
import { ExpiredBanner } from '../features/envelope/ExpiredBanner';
import { ExtendDialog } from '../features/envelope/ExtendDialog';
import { canExtend } from '../features/envelope/extend';
import { RecipientProgress } from '../features/sending/RecipientProgress';
import type { SentState } from '../features/sending/SendDialog';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { describeAuditAction, formatBytes, formatDateTime, shortHash } from '../lib/format';
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
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [extending, setExtending] = useState(false);
  const sent = (useLocation().state as SentState | null)?.sentTo;

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
  });

  useDocumentTitle(envelope?.title);

  const signerName = (recipientId: string) =>
    envelope?.recipients.find((r) => r.id === recipientId)?.name ?? 'a recipient';

  const handleCopyHash = async () => {
    if (envelope?.originalHash) {
      await navigator.clipboard.writeText(envelope.originalHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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

  if (isLoadingEnvelope) {
    return <FullPageSpinner />;
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
    <div className="flex-1 flex flex-col space-y-5 max-w-7xl mx-auto w-full pb-10">
      {/* 1. Header Bar: Document Title, Status & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-2xl px-5 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <Link
            to="/dashboard"
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors pr-2.5 border-r border-slate-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Documents</span>
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{envelope.title}</h1>
          <StatusBadge status={envelope.status} />
          <span className="text-xs bg-slate-100 text-slate-700 font-medium px-2.5 py-0.5 rounded-full">
            {envelope.pageCount} pages
          </span>
          <span className="text-xs text-slate-500">
            Created by: {envelope.owner.fullName} on {formatDateTime(envelope.createdAt)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* An expired envelope offers both choices in its banner instead. */}
          {cancelModeFor(envelope.status) && envelope.status !== 'EXPIRED' && (
            <Button
              onClick={() => setCancelling(true)}
              variant="ghost"
              className="text-xs py-1.5 px-3.5 text-red-700 hover:bg-red-50"
            >
              {cancelModeFor(envelope.status) === 'discard' ? 'Discard draft' : 'Cancel document'}
            </Button>
          )}
          {canExtend(envelope.status) && envelope.status !== 'EXPIRED' && (
            <Button
              onClick={() => setExtending(true)}
              variant="secondary"
              className="text-xs py-1.5 px-3.5"
            >
              Give more time
            </Button>
          )}
          {envelope.status === 'DRAFT' && (
            <ButtonLink
              to={`/dashboard/envelopes/${envelope.id}/prepare`}
              variant="primary"
              className="text-xs py-1.5 px-3.5"
            >
              Prepare for signing
            </ButtonLink>
          )}
          <Button
            onClick={handleDownload}
            disabled={!pdfData}
            variant={envelope.status === 'DRAFT' ? 'secondary' : 'primary'}
            className="text-xs py-1.5 px-3.5"
          >
            {envelope.status === 'COMPLETED' ? 'Download signed PDF' : 'Download PDF'}
          </Button>
        </div>
      </div>

      {sent && isOpenEnvelope(envelope.status) && (
        <Alert tone="success">Sent. We are emailing {sent} a link to sign.</Alert>
      )}

      <CompletionBanner envelope={envelope} onDownload={handleDownload} downloading={!pdfData} />
      <CancelledBanner envelope={envelope} />
      <ExpiredBanner
        envelope={envelope}
        onExtend={() => setExtending(true)}
        onCancel={() => setCancelling(true)}
      />
      {canExtend(envelope.status) && (
        <ExtendDialog envelope={envelope} open={extending} onClose={() => setExtending(false)} />
      )}
      <CancelDialog envelope={envelope} open={cancelling} onClose={() => setCancelling(false)} />

      {envelope.sentAt && <RecipientProgress envelope={envelope} />}

      {/* 2. Main Hero Document Viewer */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden flex flex-col h-[75vh] min-h-[600px] max-h-[850px]">
        {latest && latest.versionNumber > 0 && (
          <p
            className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600"
            data-testid="shown-version"
          >
            Showing v{latest.versionNumber}
            {latest.isFinal
              ? ': the sealed document, with its certificate on the last page'
              : ': the document with the signatures made so far'}
          </p>
        )}
        {isLoadingPdf ? (
          <div className="flex-1 flex items-center justify-center bg-slate-100">
            <span className="text-slate-500 text-sm font-medium">Loading document...</span>
          </div>
        ) : pdfError ? (
          <div className="flex-1 flex items-center justify-center bg-red-50 text-red-600 text-sm p-4">
            Failed to load PDF preview
          </div>
        ) : pdfData ? (
          <PdfViewer data={pdfData} className="h-full w-full" />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-100">
            <span className="text-slate-500 text-sm">Preview not available</span>
          </div>
        )}
      </div>

      {/* 3. Cryptographic Fingerprint & Security Banner */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/70 flex items-center justify-center shrink-0">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Original Document Fingerprint (SHA-256)
                </h3>
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                  Tamper-Evident SHA-256
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Immutable cryptographic hash computed at upload time
              </p>
            </div>
          </div>

          <Button
            onClick={() => void handleCopyHash()}
            variant="secondary"
            className="text-xs py-1.5 px-3 shrink-0"
          >
            {copied ? 'Copied!' : 'Copy Hash'}
          </Button>
        </div>

        <div className="pt-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 select-all break-all flex-1 leading-relaxed">
            {envelope.originalHash}
          </div>
          <div className="text-xs text-slate-500 md:text-right shrink-0">
            <p>
              Original file:{' '}
              <strong className="text-slate-800 font-medium">{envelope.originalFilename}</strong>
            </p>
            <p className="text-[11px] text-slate-400">
              {envelope.pageCount} pages • {envelope.versions.length} version
              {envelope.versions.length > 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>
      </div>

      {/* 4. Balanced 2-Column Intelligence: Document Versions & Audit Trail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (5/12): Document Versions History */}
        <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-500"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Document Versions
              </h3>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
              {envelope.versions.length}
            </span>
          </div>

          <div className="p-4 flex-1 overflow-y-auto max-h-[460px]">
            {envelope.versions.length > 0 ? (
              <div className="space-y-3">
                {envelope.versions.map((version: DocumentVersionInfo) => (
                  <div
                    key={version.versionNumber}
                    className="p-3.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs space-y-2 hover:bg-slate-100/70 hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          v{version.versionNumber}
                        </span>
                        {version.isFinal ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                            Final Sealed
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-200 text-slate-700 font-medium px-2 py-0.5 rounded-full">
                            {version.versionNumber === 0 ? 'Original' : 'Signed'}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-400 text-[11px]">
                        {formatDateTime(version.createdAt)}
                      </span>
                    </div>

                    <p className="text-slate-700">
                      {version.isFinal
                        ? 'Certificate added, sealed and locked'
                        : version.createdByRecipientId
                          ? `Signed by ${signerName(version.createdByRecipientId)}`
                          : 'As uploaded'}
                    </p>

                    <div className="flex items-center justify-between text-slate-600 text-xs pt-1 border-t border-slate-200/50">
                      <span>
                        {formatBytes(version.sizeBytes)} • {version.pageCount} pages
                      </span>
                      <span className="font-mono text-slate-500 text-[11px]" title={version.sha256}>
                        {shortHash(version.sha256)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-6 text-center">No versions recorded.</p>
            )}
          </div>
        </div>

        {/* Right Column (7/12): Cryptographic Audit Trail Timeline */}
        <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-500"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Audit Trail
              </h3>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full">
              {envelope.auditTrail.length} events
            </span>
          </div>

          <div className="p-5 flex-1 overflow-y-auto max-h-[460px]">
            {envelope.auditTrail.length > 0 ? (
              <div className="relative pl-6 space-y-3.5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {envelope.auditTrail.map((event: AuditEventInfo) => (
                  <div key={event.sequence} className="relative flex items-start gap-3">
                    {/* Timeline bullet dot */}
                    <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-white border-2 border-brand-600 flex items-center justify-center text-[9px] font-bold text-brand-700 shadow-xs">
                      {event.sequence}
                    </div>

                    {/* Timeline event card */}
                    <div className="flex-1 bg-slate-50/80 border border-slate-200/80 rounded-xl p-3 text-xs hover:bg-slate-100/70 hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          {describeAuditAction(event.action)}
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {formatDateTime(event.timestamp)}
                        </span>
                      </div>
                      <p
                        className="font-mono text-[10px] text-slate-400 mt-1 truncate select-all"
                        title={event.eventHash}
                      >
                        Event Hash: {event.eventHash}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-6 text-center">No audit events recorded.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
