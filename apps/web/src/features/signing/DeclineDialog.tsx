import { MAX_DECLINE_REASON_LENGTH } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { describeError } from '../../lib/errors';
import { reportError } from '../../lib/logger';
import { type EndState, endStateFor } from './end-states';
import { Sheet, SheetActions } from './Sheet';
import { isTransient, signingApi } from './signing-api';

/**
 * "Decline to sign", with the reason the sender will read (docs/09). Allowed
 * before agreeing to sign electronically, and it closes the document for
 * everyone, so the dialog says so before anything is sent.
 */
export function DeclineDialog({
  open,
  token,
  senderName,
  onClose,
  onEnd,
}: {
  open: boolean;
  token: string;
  senderName: string;
  onClose: () => void;
  onEnd: (state: EndState) => void;
}) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId}>
      <DeclineForm
        titleId={titleId}
        token={token}
        senderName={senderName}
        onClose={onClose}
        onEnd={onEnd}
      />
    </Sheet>
  );
}

function DeclineForm({
  titleId,
  token,
  senderName,
  onClose,
  onEnd,
}: {
  titleId: string;
  token: string;
  senderName: string;
  onClose: () => void;
  onEnd: (state: EndState) => void;
}) {
  const reasonId = useId();
  const hintId = useId();
  const [reason, setReason] = useState('');
  const [missingReason, setMissingReason] = useState(false);

  const decline = useMutation({
    mutationFn: () => signingApi.decline(token, { reason: reason.trim() }),
    onSuccess: () => onEnd({ kind: 'you-declined', justNow: true }),
    onError: (error) => {
      const end = endStateFor(error);
      if (end) onEnd(end);
      else if (isTransient(error)) reportError(error, 'signing:decline');
    },
  });

  const failure =
    decline.error && !endStateFor(decline.error) ? describeError(decline.error) : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length === 0) {
          setMissingReason(true);
          return;
        }
        decline.mutate();
      }}
    >
      <div className="space-y-4 px-5 pt-5 pb-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Decline to sign?
        </h2>
        <p className="text-sm text-slate-700">
          The document will be closed for everyone, and {senderName} will be told why. This cannot
          be undone.
        </p>
        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-slate-800">
            Reason for declining
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (event.target.value.trim()) setMissingReason(false);
            }}
            rows={4}
            maxLength={MAX_DECLINE_REASON_LENGTH}
            aria-invalid={missingReason || undefined}
            aria-describedby={hintId}
            className={`mt-1.5 block w-full rounded-lg border bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none ${
              missingReason ? 'border-red-400' : 'border-slate-300'
            }`}
          />
          <p
            id={hintId}
            className={`mt-1.5 text-xs ${missingReason ? 'text-red-700' : 'text-slate-500'}`}
          >
            {missingReason
              ? 'Tell the sender why you are declining.'
              : `Only ${senderName} will see this.`}
          </p>
        </div>
        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
      </div>
      <SheetActions>
        <Button variant="secondary" onClick={onClose}>
          Keep the document
        </Button>
        <Button type="submit" variant="danger" loading={decline.isPending}>
          Decline to sign
        </Button>
      </SheetActions>
    </form>
  );
}
