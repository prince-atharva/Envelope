import {
  canOwnFields,
  checkReadyToSend,
  type FieldInfo,
  needsFields,
  receivesSigningLink,
} from '@envelope/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { HashBlock } from '../components/ui/HashBlock';
import {
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  DocumentIcon,
  WarningIcon,
} from '../components/ui/icons';
import { ReviewPageSkeleton } from '../components/ui/Skeletons';
import { recipientColor } from '../features/builder/recipient-colors';
import { summariseSend } from '../features/sending/progress';
import { SendDialog } from '../features/sending/SendDialog';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { formatBytes, formatDateTime } from '../lib/format';
import { countFields, describeSigningOrder, roleNoun } from '../lib/labels';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/**
 * "1 signature on page 1", "3 tick boxes on pages 2, 5".
 *
 * Grouped by type and carrying that type's own pages: a sender checking a
 * draft wants to know where each kind of box landed, which a bare count and a
 * separate page list beside it does not tell them.
 */
function summariseFields(fields: FieldInfo[]): { key: string; text: string }[] {
  const groups = new Map<FieldInfo['type'], { count: number; pages: Set<number> }>();
  for (const field of fields) {
    const entry = groups.get(field.type) ?? { count: 0, pages: new Set<number>() };
    entry.count += 1;
    entry.pages.add(field.pageNumber);
    groups.set(field.type, entry);
  }
  return [...groups.entries()].map(([type, entry]) => {
    const pages = [...entry.pages].sort((a, b) => a - b);
    const where = pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(', ')}`;
    return { key: type, text: `${countFields(type, entry.count)} on ${where}` };
  });
}

/**
 * One screen showing exactly what each person will receive (docs/09, step 5).
 *
 * It exists because a wrong send cannot be undone: Send opens a dialog that
 * says who is emailed now and who later, and only that dialog sends.
 */
export function ReviewPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [sending, setSending] = useState(false);

  const {
    data: envelope,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.envelope(id),
    queryFn: () => api.getEnvelope(id),
    enabled: id.length > 0,
  });

  useDocumentTitle(envelope ? `Review · ${envelope.title}` : 'Review');

  if (isLoading) return <ReviewPageSkeleton />;
  if (error) {
    const described = describeError(error);
    return <Alert reference={described.reference}>{described.message}</Alert>;
  }
  if (!envelope) return <Alert>This document could not be found.</Alert>;

  // Sent already: there is nothing left to review.
  if (envelope.status !== 'DRAFT') return <Navigate to={`/dashboard/envelopes/${id}`} replace />;

  const issues = checkReadyToSend(envelope);
  const ready = issues.length === 0;
  // The same split the Send dialog shows, so the two can never disagree.
  const emailedFirst = new Set(
    summariseSend(envelope.recipients, envelope.sequentialSigning).now.map((r) => r.id),
  );

  const isCustomTitle =
    Boolean(envelope.originalFilename) &&
    envelope.originalFilename !== envelope.title &&
    envelope.originalFilename.replace(/\.pdf$/i, '') !== envelope.title;

  const originalVersion =
    envelope.versions.find((v) => v.versionNumber === 0) ?? envelope.versions[0];
  const fileSize =
    originalVersion && originalVersion.sizeBytes > 0
      ? formatBytes(originalVersion.sizeBytes)
      : null;

  return (
    <div className="flex flex-1 flex-col space-y-6 max-w-7xl mx-auto w-full pb-12">
      {/* 1. Header Bar: Breadcrumb, Step Badge, Title & Main Actions */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between bg-white border border-slate-200/90 rounded-2xl p-4 sm:px-6 sm:py-4 shadow-xs">
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Back link */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link
              to={`/dashboard/envelopes/${envelope.id}/prepare`}
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
              <span>Back to preparing</span>
            </Link>
          </div>

          {/* Title & Step Badge */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className="truncate text-xl font-bold text-slate-900 tracking-tight sm:text-2xl max-w-xl"
              title={envelope.title}
            >
              {envelope.title}
            </h1>
            <span className="text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200/80 px-2.5 py-0.5 whitespace-nowrap rounded-full shrink-0">
              Step 3: Review and send
            </span>
          </div>

          <p className="text-xs text-slate-500">
            This is exactly what each person will receive. A document cannot be unsent.
          </p>
        </div>

        {/* Readiness Status & Actions */}
        <div className="flex flex-wrap items-center gap-3 lg:shrink-0 lg:justify-end max-sm:[&>a]:grow max-sm:[&>button]:grow">
          {ready ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border bg-emerald-50 border-emerald-200/80 text-emerald-800 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Ready to send
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border bg-amber-50 border-amber-200/80 text-amber-800 shadow-2xs">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {issues.length} {issues.length === 1 ? 'action needed' : 'actions needed'}
            </span>
          )}

          <ButtonLink
            to={`/dashboard/envelopes/${envelope.id}/prepare`}
            variant="secondary"
            className="text-xs py-2 px-3.5 shadow-2xs"
          >
            Keep preparing
          </ButtonLink>

          <Button
            disabled={!ready}
            onClick={() => setSending(true)}
            variant="primary"
            className="text-xs py-2 px-4 shadow-2xs inline-flex items-center gap-1.5 font-bold"
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
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
            <span>Send for signing</span>
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 2. Validation Alert Banner if not ready */}
      {!ready && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
            <svg
              className="h-5 w-5 text-amber-600 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <span>The document is not ready to send yet</span>
          </div>
          <ul className="space-y-1 text-xs text-amber-800 list-disc pl-7">
            {issues.map((issue) => (
              <li
                key={`${issue.code}-${'recipientId' in issue ? issue.recipientId : 'fieldId' in issue ? issue.fieldId : ''}`}
              >
                {issue.message}
              </li>
            ))}
          </ul>
          <div className="pt-1">
            <ButtonLink
              to={`/dashboard/envelopes/${envelope.id}/prepare`}
              variant="secondary"
              className="text-xs py-1.5 px-3 bg-white"
            >
              Fix these while preparing
            </ButtonLink>
          </div>
        </div>
      )}

      {/* 3. The document on the left, who receives what on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Document Details & Cryptographic Integrity (5 cols on lg) */}
        <div className="lg:col-span-5 flex flex-col space-y-5">
          {/* Document Summary Card */}
          <Card className="space-y-4">
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
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                </div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Document details
                </h2>
              </div>
              <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 whitespace-nowrap rounded-full">
                {fileSize ? `${fileSize} · ` : ''}
                {envelope.pageCount} {envelope.pageCount === 1 ? 'page' : 'pages'}
              </span>
            </div>

            <dl className="space-y-3 text-xs">
              {isCustomTitle && (
                <div>
                  <dt className="text-slate-400 font-medium">Original file</dt>
                  <dd className="font-semibold text-slate-900 break-words mt-0.5">
                    {envelope.originalFilename}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-slate-400 font-medium">Uploaded by</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {envelope.owner.fullName} on {formatDateTime(envelope.createdAt)}
                </dd>
              </div>

              <div>
                <dt className="text-slate-400 font-medium">Signing order</dt>
                <dd className="mt-1">
                  {envelope.sequentialSigning ? (
                    <div className="flex items-start gap-2 p-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50">
                      <svg
                        className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25"
                        />
                      </svg>
                      <div>
                        <span className="block font-bold text-indigo-900">One after another</span>
                        <span className="block text-xs text-indigo-700">
                          {describeSigningOrder(true, envelope.recipients)}
                        </span>
                        <span className="mt-0.5 block text-xs text-indigo-700/90">
                          Each person is emailed only once the one before them has signed.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 p-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50">
                      <svg
                        className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                        />
                      </svg>
                      <div>
                        <span className="block font-bold text-emerald-900">
                          {describeSigningOrder(false, envelope.recipients)}
                        </span>
                        <span className="text-xs text-emerald-700">
                          Everyone who signs is emailed at once and can sign in any order.
                        </span>
                      </div>
                    </div>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-slate-400 font-medium">Message in the email</dt>
                <dd className="mt-1">
                  {envelope.message ? (
                    <blockquote className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-slate-800 text-xs italic">
                      “{envelope.message}”
                    </blockquote>
                  ) : (
                    <span className="text-slate-400 text-xs italic">
                      None. The email carries the standard invitation only.
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Cryptographic Guarantee Card */}
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
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Fingerprint
                </h2>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                SHA-256
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Taken when the document was uploaded. Any later change to the file would change it.
            </p>

            <HashBlock hash={envelope.originalHash} testId="original-hash" />

            <ul className="space-y-1.5 text-xs text-slate-600">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>Every step is recorded in a tamper-evident audit trail</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>Each signing link is personal and stops working once used</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>A certificate page is added and the document sealed once everyone signs</span>
              </li>
            </ul>
          </Card>
        </div>

        {/* Right Column: Recipient Delivery Schedule & Field Map (7 cols on lg) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          <Card className="space-y-4">
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
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Who receives what
                </h2>
              </div>
              <span className="text-xs font-semibold bg-brand-50 text-brand-700 px-2.5 py-0.5 whitespace-nowrap rounded-full border border-brand-200/60">
                {envelope.recipients.length}{' '}
                {envelope.recipients.length === 1 ? 'person' : 'people'}
              </span>
            </div>

            {envelope.recipients.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No recipients added yet. Return to the builder to add signers.
              </div>
            ) : (
              <ul className="space-y-3">
                {envelope.recipients.map((recipient, index) => {
                  const color = recipientColor(recipient.colorIndex);
                  const theirFields = envelope.fields.filter((f) => f.recipientId === recipient.id);
                  const fieldSummary = summariseFields(theirFields);

                  return (
                    <li
                      key={recipient.id}
                      className="rounded-xl border border-slate-200/90 p-4 bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all shadow-2xs space-y-3"
                    >
                      {/* Recipient Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 shadow-2xs ${color.swatch}`}
                          >
                            {envelope.sequentialSigning
                              ? index + 1
                              : recipient.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {recipient.name}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{recipient.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs capitalize font-medium text-brand-700 bg-brand-50 border border-brand-200/70 px-2.5 py-0.5 whitespace-nowrap rounded-full">
                            {roleNoun(recipient.role)}
                          </span>
                        </div>
                      </div>

                      {/* Dispatch Timing Badge */}
                      <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          {!receivesSigningLink(recipient.role) ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                              <DocumentIcon className="h-3 w-3" />
                              <span>Gets the finished document once everyone has signed</span>
                            </span>
                          ) : emailedFirst.has(recipient.id) ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 rounded-md">
                              <BoltIcon className="h-3 w-3" />
                              <span>Emailed as soon as you send</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-800 bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 rounded-md">
                              <ClockIcon className="h-3 w-3" />
                              <span>Emailed once the person before them has signed</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Assigned Fields Breakdown */}
                      {canOwnFields(recipient.role) && (
                        <div className="bg-white rounded-lg border border-slate-200/80 p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-semibold uppercase tracking-wider text-slate-600">
                              Fields
                            </span>
                          </div>

                          {fieldSummary.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {fieldSummary.map((item) => (
                                <span
                                  key={item.key}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-800"
                                >
                                  {item.text}
                                </span>
                              ))}
                            </div>
                          ) : !needsFields(recipient.role) ? (
                            <p className="text-xs text-slate-600">
                              No fields. They read the document and approve it.
                            </p>
                          ) : (
                            <p className="flex items-start gap-1.5 rounded border border-amber-200/60 bg-amber-50 p-1.5 text-xs font-medium text-amber-700">
                              <WarningIcon className="mt-0.5 h-3.5 w-3.5" />
                              <span>No fields yet. Add at least one for them before sending.</span>
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Reassurance Footer Card */}
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 shadow-2xs flex items-center gap-3.5">
            <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 border border-brand-200/60 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                />
              </svg>
            </div>
            <div className="text-xs text-slate-600">
              <strong className="font-semibold text-slate-800 block">Nothing is sent yet</strong>
              <p className="text-xs text-slate-500 mt-0.5">
                Send for signing opens a final check, where you choose how long the links work and
                whether to send reminders.
              </p>
            </div>
          </div>
        </div>
      </div>

      <SendDialog envelope={envelope} open={sending} onClose={() => setSending(false)} />
    </div>
  );
}
