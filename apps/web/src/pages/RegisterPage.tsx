import { PASSWORD_MIN_LENGTH, registerSchema } from '@envelope/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { useAuth } from '../lib/auth';
import { describeError, fieldErrorsOf } from '../lib/errors';
import { useDocumentTitle } from '../lib/use-document-title';

type Fields = 'fullName' | 'organization' | 'email' | 'password';

export function RegisterPage() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const [values, setValues] = useState<Record<Fields, string>>({
    fullName: '',
    organization: '',
    email: '',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [error, setError] = useState<{ message: string; reference?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: Fields) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({
      ...values,
      organization: values.organization.trim() || undefined,
    });
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(parsed.data);
    } catch (caught) {
      setFieldErrors(fieldErrorsOf(caught));
      setError(describeError(caught));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">
        Set up a workspace for your practice or organisation.
      </p>
      <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error && <Alert reference={error.reference}>{error.message}</Alert>}
        <TextField
          label="Full name"
          name="fullName"
          autoComplete="name"
          required
          value={values.fullName}
          onChange={update('fullName')}
          error={fieldErrors.fullName}
        />
        <TextField
          label="Organisation (optional)"
          name="organization"
          autoComplete="organization"
          value={values.organization}
          onChange={update('organization')}
          error={fieldErrors.organization}
        />
        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={update('email')}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easy to remember.`}
          value={values.password}
          onChange={update('password')}
          error={fieldErrors.password}
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
