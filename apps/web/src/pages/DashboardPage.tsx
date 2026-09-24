import { ENVELOPE_VIEWS, type EnvelopeStatus, type EnvelopeView } from '@envelope/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { DocumentListSkeleton, TopProgressBar } from '../components/ui/Skeletons';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { DocumentProgressBar } from '../features/dashboard/DocumentProgressBar';
import {
  defaultView,
  describeAttention,
  describeProgress,
  isView,
  VIEW_LABELS,
} from '../features/dashboard/dashboard';
import { envelopeListQuery } from '../features/dashboard/list-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { formatDate, formatDateTime, pluralize } from '../lib/format';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

const DONE = {
  wrapper: 'bg-emerald-50 text-emerald-600 ring-emerald-500/20',
  path: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
};
const STOPPED = {
  wrapper: 'bg-rose-50 text-rose-600 ring-rose-500/20',
  path: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
};
const IN_FLIGHT = {
  wrapper: 'bg-sky-50 text-sky-600 ring-sky-500/20',
  path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
};

/** The icon beside each row, by status. */
const STATUS_ICON: Record<EnvelopeStatus, { wrapper: string; path: string }> = {
  DRAFT: {
    wrapper: 'bg-slate-100 text-slate-600 ring-slate-400/20',
    path: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  },
  SENT: IN_FLIGHT,
  DELIVERED: IN_FLIGHT,
  PARTIALLY_SIGNED: IN_FLIGHT,
  COMPLETED: DONE,
  EXPIRED: STOPPED,
  DECLINED: STOPPED,
  VOIDED: STOPPED,
};

const EMPTY_MESSAGES: Record<EnvelopeView, { title: string; desc: string }> = {
  attention: {
    title: "You're all caught up!",
    desc: 'Nothing requires your attention or follow-up right now.',
  },
  waiting: {
    title: 'No documents waiting',
    desc: 'There are no in-flight documents currently waiting for signatures.',
  },
  completed: {
    title: 'No completed documents yet',
    desc: 'Signed and sealed documents will appear here once all parties finish.',
  },
  cancelled: {
    title: 'No cancelled documents',
    desc: 'Documents that were cancelled or declined will appear here.',
  },
  drafts: {
    title: 'No drafts',
    desc: 'Prepared documents waiting to be sent will be saved here.',
  },
  all: {
    title: 'No documents yet',
    desc: 'Upload a PDF to prepare and send your first document for signing.',
  },
};

type SortOption = 'recent' | 'deadline' | 'title';

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The sender's documents (docs/16 step 14), by tab. It opens on Needs
 * attention when anything needs it, answering "what should I chase today?"
 * rather than "what did I send last?"; otherwise on All.
 */
export function DashboardPage() {
  useDocumentTitle('Documents');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  const counts = useQuery({ queryKey: queryKeys.envelopeCounts, queryFn: api.envelopeCounts });
  const requested = params.get('view');
  // Without a tab in the URL, wait for the counts: which tab opens depends on
  // them, and guessing would fetch and flash All before switching away.
  const view: EnvelopeView | undefined = isView(requested)
    ? requested
    : counts.isPending
      ? undefined
      : defaultView(counts.data);

  // A tab's list is fetched when the sender points at or focuses it, never on
  // load: opening the dashboard asks only for the counts and the open tab.
  const prefetchTab = useCallback(
    (tab: EnvelopeView) => void queryClient.prefetchInfiniteQuery(envelopeListQuery(tab)),
    [queryClient],
  );

  const documents = useInfiniteQuery({
    ...envelopeListQuery(view ?? 'all'),
    enabled: view !== undefined,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(
    () => documents.data?.pages.flatMap((page) => page.items) ?? [],
    [documents.data],
  );
  const nothingAtAll = counts.data?.all === 0;

  // Search and sort work on the pages already loaded, so they answer at once;
  // "Load more" widens what they cover.
  const filteredItems = useMemo(() => {
    let result = items;
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((item) => {
        const titleMatch = item.title.toLowerCase().includes(query);
        const fileMatch = item.originalFilename.toLowerCase().includes(query);
        const signersMatch = item.progress?.waitingOn.some((name) =>
          name.toLowerCase().includes(query),
        );
        return titleMatch || fileMatch || signersMatch;
      });
    }

    if (sortBy === 'deadline') {
      result = [...result].sort((a, b) => {
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });
    } else if (sortBy === 'title') {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }, [items, searchQuery, sortBy]);

  const tabsId = useId();
  const searchId = useId();
  const sortId = useId();

  const firstName = user?.fullName.trim().split(/\s+/)[0];

  return (
    <div className="space-y-6 pb-8">
      {/* Header section with greeting & upload action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {/* The greeting sits under the title rather than replacing it. As the
              <h1> it renamed the page three times a day, so neither a returning
              sender nor a screen reader could rely on what this screen is. */}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Documents
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {firstName ? `${getTimeGreeting()}, ${firstName}. ` : ''}
            Manage, track, and send your documents for signature.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ButtonLink
            to="/dashboard/new"
            className="shadow-sm hover:shadow-md transition-shadow inline-flex items-center gap-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Upload document
          </ButtonLink>
        </div>
      </div>

      {/* Tabs */}
      {!nothingAtAll && view && (
        <Tabs
          idPrefix={tabsId}
          label="Document views"
          variant="underline"
          // Phones: the row runs into the page gutter and fades there, so a
          // half-shown tab reads as "scroll for more" rather than as cut off.
          className="max-sm:-mx-4 max-sm:px-4 max-sm:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]"
          value={view}
          onChange={(tab) => {
            setSearchQuery('');
            setParams({ view: tab }, { replace: true });
          }}
          items={ENVELOPE_VIEWS.map((tab) => {
            const count = counts.data?.[tab];
            return {
              id: tab,
              label: VIEW_LABELS[tab],
              count,
              countTone: tab === 'attention' && (count ?? 0) > 0 ? 'warning' : 'default',
              onMouseEnter: () => prefetchTab(tab),
              onFocus: () => prefetchTab(tab),
            };
          })}
        />
      )}

      {/* Search and Sort Toolbar */}
      {!nothingAtAll && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <label className="sr-only" htmlFor={searchId}>
              Search documents
            </label>
            <input
              id={searchId}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, file, or recipient…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm placeholder-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <label className="shrink-0 font-medium" htmlFor={sortId}>
              Sort by:
            </label>
            <select
              id={sortId}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="recent">Recent activity</option>
              <option value="deadline">Nearest deadline</option>
              <option value="title">Title (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {/* Error state */}
      {(documents.isError || counts.isError) && (
        <Alert reference={describeError(documents.error ?? counts.error).reference}>
          {describeError(documents.error ?? counts.error).message}
        </Alert>
      )}

      {/* Starter Guide: 0 Documents in Workspace */}
      {nothingAtAll && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">No documents yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Upload your first PDF. It is checked, fingerprinted and stored securely before anyone
            sees it.
          </p>

          <div className="mx-auto mt-8 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                1
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">Upload PDF</h3>
              <p className="mt-1 text-xs text-slate-600">
                Drag and drop any PDF contract or document.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                2
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">Place Fields</h3>
              <p className="mt-1 text-xs text-slate-600">
                Mark where signers should sign, date, or enter text.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                3
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">Send & Track</h3>
              <p className="mt-1 text-xs text-slate-600">
                Recipients sign from any device without accounts.
              </p>
            </div>
          </div>

          <ButtonLink to="/dashboard/new" className="mt-8">
            Upload your first document
          </ButtonLink>
        </div>
      )}

      {!nothingAtAll && !view && <DocumentListSkeleton rows={5} />}

      {!nothingAtAll && view && (
        <TabPanel idPrefix={tabsId} id={view} className="space-y-6 focus-visible:outline-none">
          {/* A hairline while a tab refreshes or switches, over the rows already shown. */}
          {documents.isFetching && !documents.isPending && <TopProgressBar />}

          {documents.isPending && <DocumentListSkeleton rows={5} />}

          {/* Tab Empty State */}
          {documents.isSuccess && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                {view === 'attention' ? (
                  <svg
                    className="h-6 w-6 text-emerald-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                )}
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">
                {EMPTY_MESSAGES[view].title}
              </h3>
              <p className="mt-1 text-sm text-slate-600 max-w-sm mx-auto">
                {EMPTY_MESSAGES[view].desc}
              </p>
              {view !== 'all' && (
                <button
                  type="button"
                  onClick={() => setParams({ view: 'all' }, { replace: true })}
                  className="mt-4 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
                >
                  View all documents →
                </button>
              )}
            </div>
          )}

          {/* Search No Results */}
          {items.length > 0 && filteredItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-900">No matching documents</p>
              <p className="mt-1 text-xs text-slate-500">
                {documents.hasNextPage
                  ? 'None of the documents loaded so far match'
                  : 'No documents in this view match'}{' '}
                &ldquo;{searchQuery.trim()}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 inline-flex items-center text-xs font-medium text-brand-700 hover:underline"
              >
                Clear search filter
              </button>
            </div>
          )}

          {/* Document List */}
          {filteredItems.length > 0 && (
            <ul
              className={`divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-opacity duration-150 ${
                documents.isPlaceholderData ? 'opacity-60 pointer-events-none' : 'opacity-100'
              }`}
              data-testid="envelope-list"
            >
              {filteredItems.map((item) => {
                const iconStyle = STATUS_ICON[item.status];
                return (
                  <li key={item.id} className="group transition-colors hover:bg-slate-50/80">
                    <Link
                      to={`/dashboard/envelopes/${item.id}`}
                      state={{ fromView: view }}
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                    >
                      {/* Left: Document Icon & Info */}
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div
                          className={`hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${iconStyle.wrapper}`}
                        >
                          <svg
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d={iconStyle.path} />
                          </svg>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-slate-900 group-hover:text-brand-800 transition-colors">
                              {item.title}
                            </p>
                            {item.attention && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-amber-600/20">
                                <svg
                                  className="h-3 w-3 shrink-0 text-orange-700"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                {describeAttention(item.attention)}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span>
                              {item.progress
                                ? describeProgress(item.progress)
                                : `${item.originalFilename} · ${pluralize(item.pageCount, 'page')}`}
                            </span>

                            {item.progress && (
                              <DocumentProgressBar
                                signed={item.progress.signed}
                                total={item.progress.total}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Date, Status Badge & Arrow */}
                      <div className="flex shrink-0 items-center justify-between sm:justify-end gap-3 text-xs text-slate-500 border-t border-slate-100 pt-2 sm:border-0 sm:pt-0">
                        {item.expiresAt && item.progress && item.progress.waitingOn.length > 0 ? (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                            <svg
                              className="h-3.5 w-3.5 text-slate-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            Due {formatDate(item.expiresAt)}
                          </span>
                        ) : (
                          <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                        )}

                        <StatusBadge status={item.status} />

                        <svg
                          className="hidden sm:block h-4 w-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination: Load more */}
          {documents.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                loading={documents.isFetchingNextPage}
                onClick={() => void documents.fetchNextPage()}
              >
                Load more documents
              </Button>
            </div>
          )}
        </TabPanel>
      )}
    </div>
  );
}
