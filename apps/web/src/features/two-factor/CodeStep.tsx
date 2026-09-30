import { secondFactorCodeSchema } from '@envelope/shared';
import { type FormEvent, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';

/**
 * The second step of a sign-in (docs/19, ADR 0024): the password was right and
 * a factor is on, so a code finishes it. A recovery code can stand in for the
 * app. On success the session is adopted and the sign-in page redirects.
 */
export function CodeStep({
  challengeToken,
  onBack,
}: {
  challengeToken: string;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = secondFactorCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError({
        message: recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code.',
      });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.completeTwoFactor({ challengeToken, code: parsed.data });
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Two-step verification</h1>
      <p className="mt-1 text-sm text-slate-600">
        {recovery
          ? 'Enter one of your recovery codes. Each works once.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error && <Alert reference={error.reference}>{error.message}</Alert>}
        <TextField
          label={recovery ? 'Recovery code' : 'Authentication code'}
          name="code"
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Verify
        </Button>
      </form>
      <div className="mt-6 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            setError(null);
          }}
          className="font-medium text-brand-700 hover:underline"
        >
          {recovery ? 'Use my authenticator app' : 'Use a recovery code instead'}
        </button>
        <button type="button" onClick={onBack} className="text-slate-600 hover:underline">
          Back to sign in
        </button>
      </div>
    </>
  );
}
