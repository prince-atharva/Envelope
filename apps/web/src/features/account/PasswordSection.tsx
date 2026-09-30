import {
  type ChangePasswordInput,
  changePasswordSchema,
  PASSWORD_MIN_LENGTH,
} from '@envelope/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ApiError, api } from '../../lib/api';
import { describeError } from '../../lib/errors';

/**
 * Change one's own password (docs/19 slice 2). The current password is asked
 * for again so that someone at an unlocked screen cannot change it; on success
 * every other device is signed out and this one stays.
 */
export function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof ChangePasswordInput, string>>
  >({});
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: (input: ChangePasswordInput) => api.changePassword(input),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setDone(true);
    },
  });

  const wrongCurrent =
    change.error instanceof ApiError && change.error.code === 'CURRENT_PASSWORD_INCORRECT';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      const errors: Partial<Record<keyof ChangePasswordInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ChangePasswordInput;
        errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    change.mutate(parsed.data);
  }

  return (
    <section
      aria-labelledby="password-heading"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-6"
    >
      <h2 id="password-heading" className="text-lg font-semibold text-slate-900">
        Password
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Changing it signs you out everywhere else. You stay signed in here.
      </p>

      <form onSubmit={onSubmit} className="mt-5 max-w-md space-y-4" noValidate>
        {done && (
          <Alert tone="success">Password changed. Your other devices were signed out.</Alert>
        )}
        {change.error && !wrongCurrent && (
          <Alert reference={describeError(change.error).reference}>
            {describeError(change.error).message}
          </Alert>
        )}
        <TextField
          label="Current password"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={
            fieldErrors.currentPassword ??
            (wrongCurrent ? describeError(change.error).message : undefined)
          }
        />
        <TextField
          label="New password"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={fieldErrors.newPassword}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <Button type="submit" loading={change.isPending}>
          Change password
        </Button>
      </form>
    </section>
  );
}
