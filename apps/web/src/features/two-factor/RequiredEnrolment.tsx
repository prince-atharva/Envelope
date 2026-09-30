import type { EnrolFinishResponse, TwoFactorSetup } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { RecoveryCodes } from './RecoveryCodes';
import { SetupPanel } from './SetupPanel';

/**
 * A workspace that requires two-factor (docs/19, ADR 0025): someone who has
 * none is taken through enrolment before they get a session. It is used after
 * a password sign-in and after accepting an invitation. The session is held
 * back until the recovery codes have been shown, then adopted.
 */
export function RequiredEnrolment({
  challengeToken,
  onSignedIn,
  onBack,
}: {
  challengeToken: string;
  /** Called after the session is adopted, for pages that have to navigate themselves. */
  onSignedIn?: () => void;
  onBack?: () => void;
}) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [finished, setFinished] = useState<EnrolFinishResponse | null>(null);

  const start = useMutation({
    mutationFn: () => api.twoFactorEnrolStart({ challengeToken }),
    onSuccess: setSetup,
  });

  if (finished) {
    return (
      <RecoveryCodes
        codes={finished.recoveryCodes}
        doneLabel="Continue to Envelope"
        onDone={() => {
          const { recoveryCodes: _shown, ...session } = finished;
          api.adoptSession(session);
          onSignedIn?.();
        }}
      />
    );
  }

  if (setup) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Set up two-factor</h1>
          <p className="mt-1 text-sm text-slate-600">
            Your workspace requires it. It takes a minute.
          </p>
        </div>
        <SetupPanel
          setup={setup}
          confirmLabel="Turn on and continue"
          onConfirm={async (code) => {
            setFinished(await api.twoFactorEnrolFinish({ challengeToken, code }));
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Two-factor is required</h1>
        <p className="mt-1 text-sm text-slate-600">
          Your workspace requires a code from an authenticator app when you sign in. Set it up now
          to continue.
        </p>
      </div>
      {start.error && (
        <Alert reference={describeError(start.error).reference}>
          {describeError(start.error).message}
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => start.mutate()} loading={start.isPending}>
          Set up two-factor
        </Button>
        {onBack && (
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        )}
      </div>
    </div>
  );
}
