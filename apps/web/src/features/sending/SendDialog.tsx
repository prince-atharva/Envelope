import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_REMINDER_INTERVAL_DAYS,
  type EnvelopeDetail,
  MAX_MESSAGE_LENGTH,
} from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { ApiError, api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { names } from '../../lib/labels';
import { queryKeys } from '../../lib/query-keys';
import { summariseSend } from './progress';
import { ReminderChoice } from './ReminderChoice';

const EXPIRY_CHOICES = [7, 14, 30] as const;

/** State passed to the envelope page after sending, for its confirmation banner. */
export interface SentState {
  sentTo: string;
}

/**
 * "Send for signing": says exactly who is emailed now and who later, then
 * sends. A document cannot be unsent, so nothing happens until Send is pressed.
 *
 * One idempotency key is kept for the life of the open dialog, so pressing Send
 * again after a dropped connection gets the first answer back rather than a
 * second send (docs/08).
 */
export function SendDialog({
  envelope,
  open,
  onClose,
}: {
  envelope: EnvelopeDetail;
  open: boolean;
  onClose: () => void;
}) {
  const keyRef = useRef<string>(crypto.randomUUID());
  const [expiresInDays, setExpiresInDays] = useState<number>(DEFAULT_EXPIRY_DAYS);
  const [message, setMessage] = useState(envelope.message ?? '');
  const [reminderIntervalDays, setReminderIntervalDays] = useState<number | null>(
    DEFAULT_REMINDER_INTERVAL_DAYS,
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const expiryId = useId();
  const messageId = useId();

  const summary = summariseSend(envelope.recipients, envelope.sequentialSigning);
  const expiresOn = formatDate(new Date(Date.now() + expiresInDays * 86_400_000).toISOString());

  const mutation = useMutation({
    mutationFn: () =>
      api.sendEnvelope(
        envelope.id,
        {
          expiresInDays,
          message: message.trim() === '' ? null : message.trim(),
          reminderIntervalDays,
        },
        keyRef.current,
      ),
    onSuccess: async () => {
      // Navigate before refreshing: the review page redirects on its own as
      // soon as it sees the envelope is sent, and that redirect has no banner.
      const state: SentState = { sentTo: names(summary.now.map((person) => person.name)) };
      await navigate(`/dashboard/envelopes/${envelope.id}`, { replace: true, state });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.envelopes }),
      ]);
    },
    onError: async (error) => {
      // Sent already, perhaps by a first attempt whose answer never arrived.
      if (error instanceof ApiError && error.code === 'ENVELOPE_NOT_DRAFT') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) });
        await navigate(`/dashboard/envelopes/${envelope.id}`, { replace: true });
      }
    },
  });

  const failure = mutation.error ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={`Send “${envelope.title}” for signing?`}
      onOpen={() => {
        keyRef.current = crypto.randomUUID();
        mutation.reset();
      }}
      onSubmit={() => mutation.mutate()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-slate-700">
        <p>
          <span className="font-medium text-slate-900">Emailed now:</span>{' '}
          {names(summary.now.map((person) => person.name))}
        </p>
        {summary.later.length > 0 && (
          <p>
            <span className="font-medium text-slate-900">Then, one after another:</span>{' '}
            {names(summary.later.map((person) => person.name))}. Each person is emailed once the one
            before them has signed.
          </p>
        )}
        {summary.copies.length > 0 && (
          <p>
            {names(summary.copies.map((person) => person.name))} will get the finished document once
            everyone has signed.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={expiryId} className="block text-sm font-medium text-slate-800">
          Links stop working after
        </label>
        <select
          id={expiryId}
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(Number(event.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {EXPIRY_CHOICES.map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">That is {expiresOn}.</p>
      </div>

      <ReminderChoice value={reminderIntervalDays} onChange={setReminderIntervalDays} />

      <div className="space-y-1">
        <label htmlFor={messageId} className="block text-sm font-medium text-slate-800">
          Message in the email <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id={messageId}
          value={message}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          onChange={(event) => setMessage(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Please sign by Friday."
        />
      </div>

      <p className="text-xs text-slate-500">A document cannot be unsent.</p>

      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}
