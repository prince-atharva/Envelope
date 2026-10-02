import type { EnvelopeDetail, RecipientDetail } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { describeError } from '../../lib/errors';
import { canHostInPerson } from './progress';

/**
 * "Sign in person": the sender hands their own device to this person (docs/22,
 * ADR 0033). The sender is signed out of this browser first, so the signer
 * cannot reach the sender's documents by going back or typing an address, and
 * the page is replaced outright so nothing of the sender's stays in memory.
 */
export function InPersonButton({
  envelope,
  recipient,
}: {
  envelope: EnvelopeDetail;
  recipient: RecipientDetail;
}) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const { signingPath } = await api.startInPerson(envelope.id, recipient.id);
      // Quiet: the app must not redirect to the sign-in page on its way to the signing page.
      await logout({ silent: true });
      // A full page load, not a route change: it drops the sender's session state from memory.
      window.location.replace(signingPath);
    },
  });

  if (!user || !canHostInPerson(recipient, envelope, user)) return null;
  const failure = mutation.error ? describeError(mutation.error) : null;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Sign in person with ${recipient.name}`}
      >
        Sign in person
      </Button>
      <DialogShell
        open={open}
        onClose={() => (mutation.isPending ? undefined : setOpen(false))}
        title={`Hand this device to ${recipient.name}?`}
        onOpen={() => mutation.reset()}
        onSubmit={() => mutation.mutate()}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Sign out and hand over
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            You will be signed out of this browser so {recipient.name} cannot see your documents.
            They sign here, then hand the device back to you.
          </p>
          <p>
            Their emailed link will stop working. The record will say they signed in person, on your
            device. When they are done, sign back in to carry on.
          </p>
        </div>
        {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
      </DialogShell>
    </>
  );
}
