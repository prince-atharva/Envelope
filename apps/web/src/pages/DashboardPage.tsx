import { ENVELOPE_VIEWS, type EnvelopeView } from '@envelope/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { StatusBadge } from '../components/ui/StatusBadge';
import {
  defaultView,
  describeAttention,
  describeProgress,
  isView,
  VIEW_LABELS,
} from '../features/dashboard/dashboard';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { formatDate, formatDateTime, pluralize } from '../lib/format';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

const EMPTY: Record<EnvelopeView, string> = {
  attention: 'Nothing needs you right now.',
  waiting: 'Nothing is waiting for signatures.',
  completed: 'No finished documents yet.',
  cancelled: 'Nothing has been cancelled or declined.',
  drafts: 'No drafts.',
  all: 'No documents yet.',
};

/**
 * The sender's documents (docs/16 step 14), by tab. It opens on Needs
 * attention when anything needs it, answering "what should I chase today?"
 * rather than "what did I send last?"; otherwise on All.
 */
export function DashboardPage() {
  useDocumentTitle('Documents');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const counts = useQuery({ queryKey: queryKeys.envelopeCounts, queryFn: api.envelopeCounts });
  const requested = params.get('view');
  const view: EnvelopeView | undefined = isView(requested)
    ? requested
    : counts.isPending
      ? undefined
      : defaultView(counts.data);

  const documents = useInfiniteQuery({
    queryKey: queryKeys.envelopeList(view ?? 'pending'),
    queryFn: ({ pageParam }) => api.listEnvelopes(view, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: view !== undefined,
  });

  const items = documents.data?.pages.flatMap((page) => page.items) ?? [];
  const nothingAtAll = counts.data?.all === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-slate-600">
            {user ? `${user.tenant.name} · ` : ''}Upload a PDF to prepare it for signing.
          </p>
        </div>
        <ButtonLink to="/dashboard/new">Upload document</ButtonLink>
      </div>

      {!nothingAtAll && view && (
        <div
          role="tablist"
          aria-label="Document views"
          className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
        >
          {ENVELOPE_VIEWS.map((tab) => {
            const count = counts.data?.[tab];
            const selected = tab === view;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setParams({ view: tab }, { replace: true })}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                  selected
                    ? 'border-brand-600 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {VIEW_LABELS[tab]}
                {count !== undefined && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                      tab === 'attention' && count > 0
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {(counts.isPending || documents.isPending) && !nothingAtAll && (
        <FullPageSpinner label="Loading documents…" />
      )}

      {(documents.isError || counts.isError) && (
        <Alert reference={describeError(documents.error ?? counts.error).reference}>
          {describeError(documents.error ?? counts.error).message}
        </Alert>
      )}

      {nothingAtAll && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">No documents yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            Upload your first PDF. It is checked, fingerprinted and stored securely before anyone
            sees it.
          </p>
          <ButtonLink to="/dashboard/new" className="mt-6">
            Upload your first document
          </ButtonLink>
        </div>
      )}

      {!nothingAtAll && view && documents.isSuccess && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-600">
          {EMPTY[view]}
        </p>
      )}

      {items.length > 0 && (
        <ul
          className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white"
          data-testid="envelope-list"
        >
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/dashboard/envelopes/${item.id}`}
                className="flex flex-col gap-2 px-4 py-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-slate-900">{item.title}</p>
                  {item.attention && (
                    <p className="text-xs font-medium text-orange-800">
                      {describeAttention(item.attention)}
                    </p>
                  )}
                  <p className="truncate text-xs text-slate-500">
                    {item.progress
                      ? describeProgress(item.progress)
                      : `${item.originalFilename} · ${pluralize(item.pageCount, 'page')}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  {item.expiresAt && item.progress && item.progress.waitingOn.length > 0 ? (
                    <span>Due {formatDate(item.expiresAt)}</span>
                  ) : (
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  )}
                  <StatusBadge status={item.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {documents.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={documents.isFetchingNextPage}
            onClick={() => void documents.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
