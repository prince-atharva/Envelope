import { PASSWORD_MIN_LENGTH } from '@envelope/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PublicFrame } from '../../components/layout/PublicFrame';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { TopProgressBar } from '../../components/ui/Skeletons';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/use-document-title';

/**
 * `/accept-invite/:token` (docs/17 step 6): a public page, reached from a
 * tenant invitation email. The token is the only credential, the same as a
 * signing link, so nothing here assumes an existing session.
 */
export default function AcceptInvitePage() {
  useDocumentTitle('Accept invitation');
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.invitationPreview(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token, { password }),
    onSuccess: () => navigate('/dashboard', { replace: true }),
  });

  if (preview.isLoading) {
    return <TopProgressBar />;
  }

  if (preview.error) {
    return (
      <PublicFrame>
        <h1 className="text-lg font-semibold text-slate-900">This invitation is not valid</h1>
        <p className="mt-2 text-sm text-slate-600">{describeError(preview.error).message}</p>
        <p className="mt-4 text-sm text-slate-600">
          Ask whoever invited you to send a new invitation.
        </p>
      </PublicFrame>
    );
  }

  const invitation = preview.data;
  if (!invitation) return null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  return (
    <PublicFrame>
      <h1 className="text-lg font-semibold text-slate-900">Join {invitation.workspaceName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        You have been invited to join "{invitation.workspaceName}" as {invitation.roleLabel}. Choose
        a password to finish setting up {invitation.email}.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <TextField
          label="Password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        {accept.error && (
          <Alert reference={describeError(accept.error).reference}>
            {describeError(accept.error).message}
          </Alert>
        )}
        <Button type="submit" loading={accept.isPending} className="w-full">
          Accept and sign in
        </Button>
      </form>
    </PublicFrame>
  );
}
