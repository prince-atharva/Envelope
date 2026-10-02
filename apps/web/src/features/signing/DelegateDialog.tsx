import { MAX_RECIPIENT_NAME_LENGTH } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { reportError } from '../../lib/logger';
import { type EndState, endStateFor } from './end-states';
import { Sheet, SheetActions } from './Sheet';
import { isTransient, signingApi } from './signing-api';

/**
 * "Pass to someone else" (docs/22, ADR 0032). Only offered when the sender
 * allowed it. The new person gets their own link and the sender is told, so the
 * dialog says plainly that this link stops working.
 */
export function DelegateDialog({
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
      <DelegateForm
        titleId={titleId}
        token={token}
        senderName={senderName}
        onClose={onClose}
        onEnd={onEnd}
      />
    </Sheet>
  );
}

function DelegateForm({
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
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [missing, setMissing] = useState(false);

  const delegate = useMutation({
    mutationFn: () => signingApi.delegate(token, { name: name.trim(), email: email.trim() }),
    onSuccess: (result) => onEnd({ kind: 'delegated', delegateName: result.delegateName }),
    onError: (error) => {
      const end = endStateFor(error);
      if (end) onEnd(end);
      else if (isTransient(error)) reportError(error, 'signing:delegate');
    },
  });

  const refusal =
    delegate.error instanceof ApiError &&
    (delegate.error.code === 'RECIPIENT_EMAIL_TAKEN' ||
      delegate.error.code === 'DELEGATION_NOT_ALLOWED')
      ? delegate.error.message
      : null;
  const failure =
    delegate.error && !endStateFor(delegate.error) && !refusal
      ? describeError(delegate.error)
      : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '' || email.trim() === '') {
          setMissing(true);
          return;
        }
        delegate.mutate();
      }}
    >
      <div className="space-y-4 px-5 pt-5 pb-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Pass this to someone else?
        </h2>
        <p className="text-sm text-slate-700">
          They will be emailed their own link and take over your part. Your link will stop working,
          and {senderName} will be told who has it now.
        </p>
        <div>
          <label htmlFor={nameId} className="block text-sm font-medium text-slate-800">
            Their name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={MAX_RECIPIENT_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={(missing && name.trim() === '') || undefined}
            autoComplete="off"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={emailId} className="block text-sm font-medium text-slate-800">
            Their email address
          </label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={(missing && email.trim() === '') || undefined}
            autoComplete="off"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none"
          />
          {missing && (name.trim() === '' || email.trim() === '') && (
            <p className="mt-1.5 text-xs text-red-700">Enter their name and email address.</p>
          )}
        </div>
        {refusal && <Alert>{refusal}</Alert>}
        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
      </div>
      <SheetActions>
        <Button variant="secondary" onClick={onClose}>
          Keep it
        </Button>
        <Button type="submit" loading={delegate.isPending}>
          Pass it on
        </Button>
      </SheetActions>
    </form>
  );
}
