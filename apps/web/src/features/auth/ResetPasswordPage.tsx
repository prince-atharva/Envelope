import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from '@envelope/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PublicFrame } from '../../components/layout/PublicFrame';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { TopProgressBar } from '../../components/ui/Skeletons';
import { ApiError, api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/use-document-title';

export interface LoginNotice {
  passwordChanged?: boolean;
}

/**
 * `/reset-password/:token` (docs/19 step 5): a public page, reached from a
 * password-reset email. The token is the only credential, so nothing here
 * assumes a session. A successful reset does not sign the person in: it sends
 * them to Sign in (ADR 0022).
 */
export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['password-reset', token],
    queryFn: () => api.passwordResetPreview(token),
    retry: false,
  });

  const reset = useMutation({
    mutationFn: () => api.resetPassword(token, { password }),
    onSuccess: () => {
      const state: LoginNotice = { passwordChanged: true };
      return navigate('/login', { replace: true, state });
    },
  });

  if (preview.isLoading) return <TopProgressBar />;

  if (preview.error) {
    const expired =
      preview.error instanceof ApiError && preview.error.code === 'PASSWORD_RESET_TOKEN_EXPIRED';
    return (
      <PublicFrame>
        <h1 className="section-title">
          {expired ? 'This link has expired' : 'This link is not valid'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{describeError(preview.error).message}</p>
        <p className="mt-4 text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Send me a new link
          </Link>
        </p>
      </PublicFrame>
    );
  }

  const details = preview.data;
  if (!details) return null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = resetPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? 'Choose a valid password.');
      return;
    }
    setInvalid(null);
    reset.mutate();
  }

  return (
    <PublicFrame>
      <h1 className="section-title">Choose a new password</h1>
      <p className="mt-2 text-sm text-slate-600">
        Choose a new password for {details.email}. You will be signed out everywhere and asked to
        sign in again.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <TextField
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={invalid ?? undefined}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        {reset.error && (
          <Alert reference={describeError(reset.error).reference}>
            {describeError(reset.error).message}
          </Alert>
        )}
        <Button type="submit" loading={reset.isPending} className="w-full">
          Change password
        </Button>
      </form>
    </PublicFrame>
  );
}
