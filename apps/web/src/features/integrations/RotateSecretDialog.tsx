import type { WebhookEndpointSummary } from '@envelope/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { HashBlock } from '../../components/ui/HashBlock';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { SECRET_OVERLAP_OPTIONS } from './integration-presentation';
import { useOneTimeSecretMutation } from './use-one-time-secret-mutation';

/**
 * Replaces a webhook's signing secret (docs/18 workstream 9). The new secret
 * is shown once, like at creation; the old one can keep verifying for a
 * chosen overlap so the receiver can switch without dropping events.
 */
export function RotateSecretDialog({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpointSummary | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const overlapId = useId();
  const [overlapHours, setOverlapHours] = useState<number>(24);
  const rotate = useOneTimeSecretMutation({
    create: async (hours: number) => {
      const result = await api.rotateWebhookSecret(endpoint?.id ?? '', { overlapHours: hours });
      return { summary: result.endpoint, rawValue: result.rawSecret };
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: queryKeys.webhookEndpoints }),
  });
  const failure = rotate.error ? describeError(rotate.error) : null;
  const close = () => {
    rotate.reset();
    onClose();
  };

  return (
    <DialogShell
      open={endpoint !== null}
      className="[&_button]:min-h-11"
      onClose={close}
      title={rotate.rawValue ? 'Copy your new signing secret' : 'Rotate signing secret'}
      onOpen={() => {
        setOverlapHours(24);
        rotate.reset();
      }}
      onSubmit={rotate.rawValue ? undefined : () => rotate.mutate(overlapHours)}
      actions={
        rotate.rawValue ? (
          <Button onClick={close}>I have saved the secret</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={rotate.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={rotate.isPending}>
              Rotate secret
            </Button>
          </>
        )
      }
    >
      {rotate.rawValue ? (
        <>
          <Alert tone="info">
            This signing secret is shown once. Give it to your receiver now.
          </Alert>
          <HashBlock
            hash={rotate.rawValue}
            label="New webhook signing secret"
            copyLabel="Copy new signing secret"
            valueName="Webhook signing secret"
            testId="rotated-webhook-secret"
          />
          <p className="text-sm text-slate-600">
            {rotate.data?.previousSecretExpiresAt
              ? `Until ${formatDateTime(rotate.data.previousSecretExpiresAt)}, each request carries a signature for the new secret and one for the old, so a receiver can accept either while it switches over.`
              : 'The old secret no longer works.'}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Creates a new signing secret for this endpoint. Events sent from now on are signed with
            it.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor={overlapId}>
              Keep the old secret working for
            </label>
            <select
              id={overlapId}
              value={overlapHours}
              onChange={(event) => setOverlapHours(Number(event.target.value))}
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
            >
              {SECRET_OVERLAP_OPTIONS.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              During this time requests carry a signature for both secrets. If you rotate again
              before then, the oldest secret stops working straight away.
            </p>
          </div>
          {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
        </>
      )}
    </DialogShell>
  );
}
