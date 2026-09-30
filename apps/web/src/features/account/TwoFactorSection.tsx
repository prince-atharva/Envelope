import { type ConfirmTwoFactorInput, confirmTwoFactorSchema } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { RecoveryCodes } from '../two-factor/RecoveryCodes';
import { SetupPanel } from '../two-factor/SetupPanel';

type Mode =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; otpauthUri: string }
  | { kind: 'codes'; codes: string[]; heading: 'enabled' | 'replaced' }
  | { kind: 'regenerate' }
  | { kind: 'disable' };

/** Password plus a current code: what turning it off, or replacing the recovery codes, asks for. */
function ConfirmFactorForm({
  submitLabel,
  destructive,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  destructive?: boolean;
  onSubmit: (input: ConfirmTwoFactorInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: onSubmit });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = confirmTwoFactorSchema.safeParse({ password, code });
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'Check both fields.');
      return;
    }
    setInvalid(null);
    mutation.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4" noValidate>
      {(invalid || mutation.error) && (
        <Alert reference={mutation.error ? describeError(mutation.error).reference : undefined}>
          {invalid ?? (mutation.error ? describeError(mutation.error).message : '')}
        </Alert>
      )}
      <TextField
        label="Password"
        type="password"
        name="confirmPassword"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <TextField
        label="Code or recovery code"
        name="confirmCode"
        autoComplete="one-time-code"
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
        hint="The 6-digit code from your app, or one unused recovery code."
      />
      <div className="flex gap-3">
        <Button
          type="submit"
          variant={destructive ? 'danger' : 'primary'}
          loading={mutation.isPending}
        >
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Two-factor authentication for the signed-in person (docs/19, ADR 0024): set
 * up, replace the recovery codes, or turn it off. Turning it off is not offered
 * when the workspace requires it (ADR 0025).
 */
export function TwoFactorSection() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const status = useQuery({ queryKey: queryKeys.twoFactor, queryFn: api.twoFactorStatus });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.twoFactor });

  const setup = useMutation({
    mutationFn: () => api.twoFactorSetup(),
    onSuccess: (data) => setMode({ kind: 'setup', ...data }),
  });

  const data = status.data;

  return (
    <section
      aria-labelledby="two-factor-heading"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-6"
    >
      <h2 id="two-factor-heading" className="text-lg font-semibold text-slate-900">
        Two-factor authentication
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        A code from an authenticator app, asked for after your password when you sign in.
      </p>

      <div className="mt-5 space-y-4">
        {status.error && <Alert>{describeError(status.error).message}</Alert>}
        {setup.error && <Alert>{describeError(setup.error).message}</Alert>}

        {mode.kind === 'setup' && (
          <SetupPanel
            setup={mode}
            onConfirm={async (code) => {
              const { recoveryCodes } = await api.twoFactorEnable({ code });
              await refresh();
              setMode({ kind: 'codes', codes: recoveryCodes, heading: 'enabled' });
            }}
          />
        )}

        {mode.kind === 'codes' && (
          <RecoveryCodes
            codes={mode.codes}
            doneLabel="Done"
            onDone={() => setMode({ kind: 'idle' })}
          />
        )}

        {mode.kind === 'regenerate' && (
          <ConfirmFactorForm
            submitLabel="Replace recovery codes"
            onCancel={() => setMode({ kind: 'idle' })}
            onSubmit={async (input) => {
              const { recoveryCodes } = await api.twoFactorRecoveryCodes(input);
              await refresh();
              setMode({ kind: 'codes', codes: recoveryCodes, heading: 'replaced' });
            }}
          />
        )}

        {mode.kind === 'disable' && (
          <ConfirmFactorForm
            submitLabel="Turn off two-factor"
            destructive
            onCancel={() => setMode({ kind: 'idle' })}
            onSubmit={async (input) => {
              await api.twoFactorDisable(input);
              await refresh();
              setMode({ kind: 'idle' });
            }}
          />
        )}

        {mode.kind === 'idle' && data && !data.enabled && (
          <div className="space-y-3">
            {data.required && (
              <Alert tone="warning">
                Your workspace requires two-factor authentication. Set it up to keep signing in.
              </Alert>
            )}
            <Button onClick={() => setup.mutate()} loading={setup.isPending}>
              Set up two-factor authentication
            </Button>
          </div>
        )}

        {mode.kind === 'idle' && data?.enabled && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-700">Two-factor authentication is on.</p>
            <p className="text-sm text-slate-600">
              {data.recoveryCodesRemaining} unused recovery{' '}
              {data.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left.
            </p>
            {data.required && (
              <p className="text-sm text-slate-500">
                Your workspace requires it, so it cannot be turned off.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setMode({ kind: 'regenerate' })}>
                Show new recovery codes
              </Button>
              {!data.required && (
                <Button variant="secondary" onClick={() => setMode({ kind: 'disable' })}>
                  Turn off two-factor
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
