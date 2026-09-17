import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { StatusBadge } from '../components/ui/StatusBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { formatDateTime, pluralize } from '../lib/format';
import { useDocumentTitle } from '../lib/use-document-title';

export function DashboardPage() {
  useDocumentTitle('Documents');
  const { user } = useAuth();
  const documents = useInfiniteQuery({
    queryKey: ['envelopes'],
    queryFn: ({ pageParam }) => api.listEnvelopes(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const items = documents.data?.pages.flatMap((page) => page.items) ?? [];

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

      {documents.isPending && <FullPageSpinner label="Loading documents…" />}

      {documents.isError && (
        <Alert reference={describeError(documents.error).reference}>
          {describeError(documents.error).message}
        </Alert>
      )}

      {documents.isSuccess && items.length === 0 && (
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
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{item.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {item.originalFilename} · {pluralize(item.pageCount, 'page')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
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
