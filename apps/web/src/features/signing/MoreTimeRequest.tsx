import { useMutation } from '@tanstack/react-query';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { describeError } from '../../lib/errors';
import { reportError } from '../../lib/logger';
import { isTransient, signingApi } from './signing-api';

/**
 * "Ask for more time", on the expired-link screen (docs/16 step 8). The sender
 * is emailed; when they give more time, a new email brings a fresh link.
 */
export function MoreTimeRequest({ token }: { token: string }) {
  const request = useMutation({
    mutationFn: () => signingApi.requestMoreTime(token),
    onError: (error) => {
      if (isTransient(error)) reportError(error, 'signing:request-more-time');
    },
  });

  if (request.data) {
    return (
      <p
        role="status"
        className="max-w-md rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        {request.data.alreadyRequested
          ? 'You have already asked today, and the sender has been told.'
          : 'We have asked the sender for more time.'}{' '}
        If they give it, you will get a new email with a fresh link.
      </p>
    );
  }

  const failure = request.error ? describeError(request.error) : null;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <Button onClick={() => request.mutate()} loading={request.isPending}>
        Ask for more time
      </Button>
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </div>
  );
}
