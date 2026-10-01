import { type TwoFactorSetup, totpCodeSchema } from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { describeError } from '../../lib/errors';

/** "ABCDEFGH…" as "ABCD EFGH …", easier to read off a screen into an app. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Scan-or-type enrolment (docs/19, ADR 0024): the QR code is drawn here in the
 * browser from the otpauth URI, so the secret goes to no third party, and a
 * code from the app confirms it. The caller decides what confirming does.
 */
export function SetupPanel({
  setup,
  onConfirm,
  confirmLabel = 'Turn on',
}: {
  setup: TwoFactorSetup;
  onConfirm: (code: string) => Promise<unknown>;
  confirmLabel?: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        // The typed key below still works.
      });
    return () => {
      alive = false;
    };
  }, [setup.otpauthUri]);

  const confirm = useMutation({ mutationFn: (value: string) => onConfirm(value) });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
      return;
    }
    setInvalid(null);
    confirm.mutate(parsed.data);
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-5 pl-5 text-sm text-slate-700">
        <li>
          Scan this code with an authenticator app such as Google Authenticator, 1Password or Authy.
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            {qr ? (
              <img
                src={qr}
                alt="QR code for your authenticator app"
                width={192}
                height={192}
                className="h-48 w-48 rounded-lg border border-slate-200 bg-white p-1"
              />
            ) : (
              <div className="h-48 w-48 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />
            )}
            <div className="text-xs text-slate-500">
              Cannot scan it? Enter this key instead:
              <p className="mt-1 break-all font-mono text-sm text-slate-800">
                {groupSecret(setup.secret)}
              </p>
            </div>
          </div>
        </li>
        <li>Enter the 6-digit code the app shows to turn it on.</li>
      </ol>

      <form onSubmit={onSubmit} className="max-w-xs space-y-5" noValidate>
        {confirm.error && (
          <Alert reference={describeError(confirm.error).reference}>
            {describeError(confirm.error).message}
          </Alert>
        )}
        <TextField
          label="Code from your app"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={invalid ?? undefined}
        />
        <Button type="submit" loading={confirm.isPending}>
          {confirmLabel}
        </Button>
      </form>
    </div>
  );
}
