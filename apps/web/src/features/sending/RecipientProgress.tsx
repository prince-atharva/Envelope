import { type EnvelopeDetail, type RecipientDetail, receivesSigningLink } from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { recipientColor } from '../builder/recipient-colors';
import { type ProgressTone, progressOf, reminderState } from './progress';

const TONE: Record<ProgressTone, string> = {
  waiting: 'bg-slate-100 text-slate-700 ring-slate-200',
  active: 'bg-sky-50 text-sky-800 ring-sky-200',
  done: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  stopped: 'bg-red-50 text-red-800 ring-red-200',
  muted: 'bg-slate-50 text-slate-500 ring-slate-200',
};

function ReminderButton({
  envelope,
  recipient,
}: {
  envelope: EnvelopeDetail;
  recipient: RecipientDetail;
}) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api.remind(envelope.id, { recipientIds: [recipient.id] }),
    onSuccess: async () => {
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) });
    },
  });

  const state = reminderState(recipient, envelope.recipients, envelope);
  if (!state.can && state.reason !== 'too-soon') return null;

  const failure = mutation.error ? describeError(mutation.error).message : null;
  return (
    <div className="flex flex-col items-end gap-1">
      {state.can && !sent ? (
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          aria-label={`Send a reminder to ${recipient.name}`}
        >
          Send reminder
        </Button>
      ) : (
        <span className="text-xs text-slate-500">
          {sent || !recipient.lastRemindedAt
            ? 'Reminder sent'
            : `Reminded ${formatRelative(recipient.lastRemindedAt)}`}
        </span>
      )}
      {failure && (
        <span role="alert" className="text-xs text-red-700">
          {failure}
        </span>
      )}
    </div>
  );
}

/**
 * Who has done what, for a sent envelope. The sender watches this instead of
 * wondering whether the email arrived.
 */
export function RecipientProgress({ envelope }: { envelope: EnvelopeDetail }) {
  const declined = envelope.recipients.find((recipient) => recipient.status === 'DECLINED');
  const open = ['SENT', 'DELIVERED', 'PARTIALLY_SIGNED'].includes(envelope.status);

  return (
    <section
      aria-labelledby="progress-heading"
      className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="progress-heading" className="text-sm font-bold text-slate-900">
          Signing progress
        </h2>
        <p className="text-xs text-slate-500">
          {envelope.sequentialSigning ? 'One after another' : 'Everyone at once'}
          {open && envelope.expiresAt && ` · Links work until ${formatDate(envelope.expiresAt)}`}
        </p>
      </div>

      {declined && (
        <Alert>
          <p>
            <span className="font-medium">{declined.name} declined</span>, so this document can no
            longer be signed.
          </p>
          {declined.declinedReason && (
            <p className="mt-1 whitespace-pre-line">Their reason: “{declined.declinedReason}”</p>
          )}
        </Alert>
      )}

      <ol className="divide-y divide-slate-100">
        {envelope.recipients.map((recipient, index) => {
          const progress = progressOf(recipient, envelope.status);
          const color = recipientColor(recipient.colorIndex);
          return (
            <li
              key={recipient.id}
              className="flex flex-wrap items-center gap-3 py-3"
              data-recipient-id={recipient.id}
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 shrink-0 rounded-full ${color.swatch}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {envelope.sequentialSigning ? `${index + 1}. ` : ''}
                  {recipient.name}
                </p>
                <p className="truncate text-xs text-slate-500">{recipient.email}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[progress.tone]}`}
                >
                  {progress.label}
                </span>
                {progress.at && (
                  <span className="text-[11px] text-slate-400">{formatDateTime(progress.at)}</span>
                )}
                {receivesSigningLink(recipient.role) && recipient.copySentAt && (
                  <span className="text-[11px] text-slate-500">
                    Finished copy sent {formatDateTime(recipient.copySentAt)}
                  </span>
                )}
              </div>
              <ReminderButton envelope={envelope} recipient={recipient} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
