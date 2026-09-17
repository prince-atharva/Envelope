import { loginSchema } from '@digitalsign/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/errors';
import { useDocumentTitle } from '../lib/use-document-title';

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);

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
      // On success the session changes and GuestOnly redirects to the dashboard.
      await login(parsed.data);
    } catch (caught) {
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Welcome back. Sign in to manage your documents.</p>
      <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
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
        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New to Digital Sign?{' '}
        <Link to="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
