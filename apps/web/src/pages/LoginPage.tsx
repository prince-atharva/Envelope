import { isMfaChallenge, isMfaEnrolmentRequired, loginSchema } from '@envelope/shared';
import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import type { LoginNotice } from '../features/auth/ResetPasswordPage';
import { CodeStep } from '../features/two-factor/CodeStep';
import { RequiredEnrolment } from '../features/two-factor/RequiredEnrolment';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { useDocumentTitle } from '../lib/use-document-title';

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const passwordChanged = (useLocation().state as LoginNotice | null)?.passwordChanged === true;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);
  // After a right password, a workspace or account can ask for a second step before any session.
  const [step, setStep] = useState<{
    kind: 'code' | 'enrol';
    challengeToken: string;
  } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError({ message: 'Enter your email address and password.' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // A session changes the auth state and GuestOnly redirects to the dashboard;
      // otherwise a second step is asked for first (ADR 0024, ADR 0025).
      const result = await login(parsed.data);
      if (isMfaChallenge(result)) {
        setStep({ kind: 'code', challengeToken: result.challengeToken });
        setSubmitting(false);
      } else if (isMfaEnrolmentRequired(result)) {
        setStep({ kind: 'enrol', challengeToken: result.challengeToken });
        setSubmitting(false);
      }
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  if (step?.kind === 'code') {
    return <CodeStep challengeToken={step.challengeToken} onBack={() => setStep(null)} />;
  }
  if (step?.kind === 'enrol') {
    return <RequiredEnrolment challengeToken={step.challengeToken} onBack={() => setStep(null)} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Welcome back. Sign in to manage your documents.</p>
      <form className="mt-6 space-y-5" onSubmit={(event) => void onSubmit(event)} noValidate>
        {passwordChanged && !error && (
          <Alert tone="success">Password changed. Sign in with your new password.</Alert>
        )}
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
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-right text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New to Envelope?{' '}
        <Link to="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
