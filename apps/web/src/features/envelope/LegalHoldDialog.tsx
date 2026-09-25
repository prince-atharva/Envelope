import { type EnvelopeDetail, MAX_LEGAL_HOLD_REASON_LENGTH } from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { api } from '../../lib/api';
import { describeError, fieldErrorsOf } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';

/** Placing a legal hold (docs/17 step 7): overrides every retention sweep until released. */
export function LegalHoldDialog({
  envelope,
  open,
  onClose,
}: {
  envelope: EnvelopeDetail;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const queryClient = useQueryClient();
  const reasonId = useId();
  const reasonHintId = useId();

  const mutation = useMutation({
    mutationFn: () => api.placeLegalHold(envelope.id, { reason: reason.trim() }),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.envelope(envelope.id) });
    },
  });

  const reasonError = missingReason
    ? 'Give a reason for the hold.'
    : fieldErrorsOf(mutation.error).reason;
  const failure = mutation.error && !reasonError ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="Place a legal hold"
      onOpen={() => {
        setReason('');
        setMissingReason(false);
        mutation.reset();
      }}
      onSubmit={() => {
        if (reason.trim().length === 0) {
          setMissingReason(true);
          return;
        }
        mutation.mutate();
      }}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Place hold
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        Nothing about this document can be cancelled, extended, or removed by retention until the
        hold is released.
      </p>
      <div className="space-y-1">
        <label htmlFor={reasonId} className="block text-sm font-medium text-slate-800">
          Reason
        </label>
        <textarea
          id={reasonId}
          value={reason}
          maxLength={MAX_LEGAL_HOLD_REASON_LENGTH}
          rows={3}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonHintId}
          onChange={(event) => {
            setReason(event.target.value);
            if (event.target.value.trim()) setMissingReason(false);
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Anticipated dispute over this contract."
        />
        <p
          id={reasonHintId}
          role={reasonError ? 'alert' : undefined}
          className={`text-xs ${reasonError ? 'text-red-700' : 'text-slate-500'}`}
        >
          {reasonError ?? 'Kept with the hold, for your own record.'}
        </p>
      </div>
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}
