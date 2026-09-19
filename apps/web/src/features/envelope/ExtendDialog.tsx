import type { EnvelopeDetail } from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError, api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { freshLinkFor, names } from './extend';

const DAY_CHOICES = [3, 7, 14, 30] as const;
const DEFAULT_DAYS = 7;

/**
 * "Give more time" (docs/16 step 9). Sets a new deadline counted from today.
 * On an expired envelope it reopens it; either way whoever's turn it is gets a
 * new link, so the dialog names them before anything is sent.
 *
 * One idempotency key for the life of the open dialog, as the send dialog
 * does: pressing again after a dropped connection gets the first answer, not a
 * second round of emails.
 */
export function ExtendDialog({
  envelope,
  open,
  onClose,
}: {
  envelope: EnvelopeDetail;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keyRef = useRef<string>(crypto.randomUUID());
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const queryClient = useQueryClient();
  const titleId = useId();
  const daysId = useId();

  const expired = envelope.status === 'EXPIRED';
  const emailed = freshLinkFor(envelope.recipients);
  const newDeadline = formatDate(new Date(Date.now() + days * 86_400_000).toISOString());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.envelopes }),
    ]);

  const mutation = useMutation({
    mutationFn: () => api.extendEnvelope(envelope.id, { expiresInDays: days }, keyRef.current),
    onSuccess: async () => {
      onClose();
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'ENVELOPE_TERMINAL') await refresh();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      keyRef.current = crypto.randomUUID();
      setDays(DEFAULT_DAYS);
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, mutation.reset]);

  const failure = mutation.error ? describeError(mutation.error) : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form
        method="dialog"
        className="space-y-4 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Give more time to sign “{envelope.title}”?
        </h2>

        <div className="space-y-1">
          <label htmlFor={daysId} className="block text-sm font-medium text-slate-800">
            New deadline
          </label>
          <select
            id={daysId}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {DAY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice} days from today
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">Links will work until {newDeadline}.</p>
        </div>

        <div className="space-y-2 text-sm text-slate-700">
          {expired && <p>Signatures already made are kept. Nobody has to sign again.</p>}
          <p>
            {emailed.length > 0 ? (
              <>
                <span className="font-medium text-slate-900">We will email</span> {names(emailed)} a
                new link. Links in earlier emails stop working.
              </>
            ) : (
              'Whoever signs next is emailed when their turn comes.'
            )}
          </p>
        </div>

        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Not now
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Give more time
          </Button>
        </div>
      </form>
    </dialog>
  );
}
