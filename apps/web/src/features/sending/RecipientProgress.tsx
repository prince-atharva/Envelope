import {
  type EnvelopeDetail,
  isOpenEnvelope,
  type RecipientDetail,
  receivesSigningLink,
} from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { roleNoun } from '../../lib/labels';
import { queryKeys } from '../../lib/query-keys';
import { recipientColor } from '../builder/recipient-colors';
import { canExtend } from '../envelope/extend';
import { type ProgressTone, progressOf, reminderState } from './progress';
import { ReminderChoice } from './ReminderChoice';

const TONE: Record<ProgressTone, string> = {
  waiting: 'bg-slate-100 text-slate-700 ring-slate-200',
  active: 'bg-sky-50 text-sky-800 ring-sky-300 font-semibold',
  done: 'bg-emerald-100 text-emerald-900 ring-emerald-300 font-semibold',
  stopped: 'bg-red-50 text-red-800 ring-red-300 font-semibold',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
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
    <div className="flex shrink-0 flex-col items-end gap-1">
      {state.can && !sent ? (
        <Button
          variant="secondary"
          size="sm"
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

/** Changes automatic reminders on a sent envelope, saving as soon as a choice is made. */
function ReminderSetting({ envelope }: { envelope: EnvelopeDetail }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (intervalDays: number | null) => api.updateReminders(envelope.id, { intervalDays }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) }),
  });
  const failure = mutation.error ? describeError(mutation.error).message : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <ReminderChoice
        compact
        value={mutation.isPending ? (mutation.variables ?? null) : envelope.reminderIntervalDays}
        disabled={mutation.isPending}
        onChange={(days) => mutation.mutate(days)}
      />
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
  const headingId = useId();
  const declined = envelope.recipients.find((recipient) => recipient.status === 'DECLINED');
  const open = isOpenEnvelope(envelope.status);

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-sm font-bold text-slate-900">
          Signing progress
        </h2>
        <p className="text-xs text-slate-500">
          {envelope.sequentialSigning ? 'One after another' : 'Everyone at once'}
          {open && envelope.expiresAt && ` · Links work until ${formatDate(envelope.expiresAt)}`}
        </p>
        {canExtend(envelope.status) && <ReminderSetting envelope={envelope} />}
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
            // Two lines, not one: this card sits in a narrow sidebar, and a single
            // row squeezed the name to "prin…" and broke the email over three lines.
            <li key={recipient.id} className="space-y-2 py-3" data-recipient-id={recipient.id}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${color.swatch}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-900">
                    {envelope.sequentialSigning ? `${index + 1}. ` : ''}
                    {recipient.name}
                    {recipient.role !== 'SIGNER' && (
                      <span className="ml-1.5 text-xs font-medium text-slate-500">
                        {roleNoun(recipient.role)}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-600" title={recipient.email}>
                    {recipient.email}
                  </p>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[progress.tone]}`}
                >
                  {progress.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pl-6">
                <div className="min-w-0 space-y-0.5 text-xs text-slate-500">
                  {progress.at && <p>{formatDateTime(progress.at)}</p>}
                  {recipient.moreTimeRequestedAt && canExtend(envelope.status) && (
                    <p className="font-semibold text-amber-800">
                      Asked for more time {formatRelative(recipient.moreTimeRequestedAt)}
                    </p>
                  )}
                  {receivesSigningLink(recipient.role) && recipient.copySentAt && (
                    <p>Finished copy sent {formatDateTime(recipient.copySentAt)}</p>
                  )}
                </div>
                <ReminderButton envelope={envelope} recipient={recipient} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
