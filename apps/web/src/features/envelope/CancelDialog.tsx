import { type EnvelopeDetail, MAX_VOID_REASON_LENGTH } from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError, api } from '../../lib/api';
import { describeError, fieldErrorsOf } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { cancelModeFor, toldOfCancellation } from './cancel';

function names(people: { name: string }[]): string {
  const list = people.map((person) => person.name);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

/**
 * "Cancel document" for a sent envelope, or "Discard draft" (docs/16 step 5).
 * Cancelling cannot be undone and stops every signing link at once, so the
 * dialog says who will be told and asks for the reason they will read.
 */
export function CancelDialog({
  envelope,
  open,
  onClose,
}: {
  envelope: EnvelopeDetail;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleId = useId();
  const reasonId = useId();
  const reasonHintId = useId();

  const discard = cancelModeFor(envelope.status) === 'discard';
  const told = toldOfCancellation(envelope.recipients);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.envelopes }),
    ]);

  const mutation = useMutation({
    mutationFn: () => api.voidEnvelope(envelope.id, discard ? {} : { reason: reason.trim() }),
    onSuccess: async () => {
      onClose();
      if (discard) await navigate('/dashboard', { replace: true });
      await refresh();
    },
    onError: async (error) => {
      // Finished, declined or cancelled in the meantime: show what it is now.
      if (error instanceof ApiError && error.code === 'ENVELOPE_TERMINAL') await refresh();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason('');
      setMissingReason(false);
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, mutation.reset]);

  const reasonError = missingReason
    ? 'Tell the people you sent it to why it is cancelled.'
    : fieldErrorsOf(mutation.error).reason;
  const failure = mutation.error && !reasonError ? describeError(mutation.error) : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form
        method="dialog"
        noValidate
        className="space-y-4 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!discard && reason.trim().length === 0) {
            setMissingReason(true);
            return;
          }
          mutation.mutate();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {discard ? `Discard “${envelope.title}”?` : `Cancel “${envelope.title}”?`}
        </h2>

        {discard ? (
          <p className="text-sm text-slate-700">
            This draft was never sent, so nobody is emailed. It is removed from your drafts and
            cannot be sent later.
          </p>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p>
              Every signing link stops working at once. Signatures already made stay in the history,
              but the document can never be finished.
            </p>
            <p>
              {told.length > 0 ? (
                <>
                  <span className="font-medium text-slate-900">We will email</span> {names(told)} to
                  say it is cancelled, with your reason.
                </>
              ) : (
                'Nobody has been emailed yet, so nobody needs to be told.'
              )}
            </p>
          </div>
        )}

        {!discard && (
          <div className="space-y-1">
            <label htmlFor={reasonId} className="block text-sm font-medium text-slate-800">
              Reason
            </label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={MAX_VOID_REASON_LENGTH}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonHintId}
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.trim()) setMissingReason(false);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="The terms changed; a new version is on its way."
            />
            <p
              id={reasonHintId}
              className={`text-xs ${reasonError ? 'text-red-700' : 'text-slate-500'}`}
            >
              {reasonError ?? 'The people you sent it to will read this.'}
            </p>
          </div>
        )}

        <p className="text-xs text-slate-500">This cannot be undone.</p>

        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {discard ? 'Keep draft' : 'Keep it'}
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending}>
            {discard ? 'Discard draft' : 'Cancel document'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
