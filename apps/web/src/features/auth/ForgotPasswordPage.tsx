import { forgotPasswordSchema, PASSWORD_RESET_TOKEN_EXPIRY_MINUTES } from '@envelope/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ApiError, api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/use-document-title';

/**
 * `/forgot-password` (docs/19 step 5): asks for a reset link. The server answers
 * the same for every address (ADR 0022), so this page never says whether an
 * account exists, and neither does its wording.
 */
export function ForgotPasswordPage() {
  useDocumentTitle('Forgot password');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError({ message: 'Enter the email address of your account.' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.forgotPassword(parsed.data);
      setSent(response.message);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'RATE_LIMITED'
          ? { message: 'Too many reset requests. Please wait an hour and try again.' }
          : describeError(caught),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <>
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <div className="mt-4">
          <Alert tone="success">{sent}</Alert>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          The link works once and expires in {PASSWORD_RESET_TOKEN_EXPIRY_MINUTES} minutes. If
          nothing arrives, check your spam folder.
        </p>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Forgot your password?</h1>
      <p className="mt-1 text-sm text-slate-600">
        Enter the email address of your account and we will send you a link to choose a new
        password.
      </p>
      <form className="mt-6 space-y-5" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error && <Alert reference={error.reference}>{error.message}</Alert>}
        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
