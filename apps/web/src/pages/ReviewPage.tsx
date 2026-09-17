import {
  canOwnFields,
  checkReadyToSend,
  type FieldInfo,
  type RecipientRole,
} from '@envelope/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button, ButtonLink } from '../components/ui/Button';
import { FullPageSpinner } from '../components/ui/Spinner';
import { recipientColor } from '../features/builder/recipient-colors';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

const ROLE_LABEL: Record<RecipientRole, string> = {
  SIGNER: 'Signs',
  APPROVER: 'Approves',
  VIEWER: 'Views only',
  CC: 'Gets a copy',
};

const FIELD_LABEL: Record<FieldInfo['type'], string> = {
  SIGNATURE: 'signature',
  INITIALS: 'initials',
  DATE_SIGNED: 'date',
  TEXT_INPUT: 'text',
  CHECKBOX: 'tick box',
};

function summariseFields(fields: FieldInfo[]): string {
  if (fields.length === 0) return 'No fields';
  const counts = new Map<string, number>();
  for (const field of fields) {
    const label = FIELD_LABEL[field.type];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(', ');
}

/**
 * One screen showing exactly what each person will receive (docs/09, step 5).
 *
 * It exists because a wrong send cannot be undone. Sending itself is Phase 3, so
 * the button is here but disabled.
 */
export function ReviewPage() {
  const { id = '' } = useParams<{ id: string }>();

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

  if (isLoading) return <FullPageSpinner label="Loading…" />;
  if (error) {
    const described = describeError(error);
    return <Alert reference={described.reference}>{described.message}</Alert>;
  }
  if (!envelope) return <Alert>This document could not be found.</Alert>;

  const issues = checkReadyToSend(envelope);
  const ready = issues.length === 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="space-y-1">
        <Link
          to={`/dashboard/envelopes/${envelope.id}/prepare`}
          className="text-xs text-slate-500 hover:underline"
        >
          ← Back to preparing
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Review before sending</h1>
        <p className="text-sm text-slate-600">
          This is exactly what each person will receive. A document cannot be unsent.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">The document</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Title</dt>
            <dd className="font-medium text-slate-900">{envelope.title}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Pages</dt>
            <dd className="font-medium text-slate-900">{envelope.pageCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Signing order</dt>
            <dd className="font-medium text-slate-900">
              {envelope.sequentialSigning ? 'One at a time, in order' : 'Everyone at once'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Message</dt>
            <dd className="font-medium text-slate-900">{envelope.message ?? 'None'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          People ({envelope.recipients.length})
        </h2>
        {envelope.recipients.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nobody has been added yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {envelope.recipients.map((recipient, index) => {
              const color = recipientColor(recipient.colorIndex);
              const theirFields = envelope.fields.filter((f) => f.recipientId === recipient.id);
              const pages = [...new Set(theirFields.map((f) => f.pageNumber))].sort(
                (a, b) => a - b,
              );
              return (
                <li
                  key={recipient.id}
                  className="flex gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-3 w-3 shrink-0 rounded-full ${color.swatch}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {envelope.sequentialSigning ? `${index + 1}. ` : ''}
                      {recipient.name}
                    </p>
                    <p className="truncate text-sm text-slate-600">{recipient.email}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {ROLE_LABEL[recipient.role]}
                      {canOwnFields(recipient.role) && (
                        <>
                          {' · '}
                          {summariseFields(theirFields)}
                          {pages.length > 0 &&
                            ` on page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!ready && (
        <Alert tone="info">
          <p className="font-medium">Not ready to send yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((issue) => (
              <li
                key={`${issue.code}-${'recipientId' in issue ? issue.recipientId : 'fieldId' in issue ? issue.fieldId : ''}`}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink to={`/dashboard/envelopes/${envelope.id}/prepare`} variant="secondary">
          Keep preparing
        </ButtonLink>
        <Button disabled title="Sending arrives in Phase 3">
          Send for signing
        </Button>
        <p className="text-xs text-slate-500">
          Sending, the email links and the signing screen arrive in the next phase.
        </p>
      </div>
    </div>
  );
}
