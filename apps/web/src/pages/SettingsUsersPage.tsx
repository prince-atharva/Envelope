import type { ChangeUserRoleInput, InviteUserInput, TenantUser, UserRole } from '@envelope/shared';
import { USER_ROLES } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DialogShell } from '../components/ui/DialogShell';
import { TextField } from '../components/ui/Field';
import { EnvelopeDetailSkeleton } from '../components/ui/Skeletons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { describeError, fieldErrorsOf } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { USER_ROLE_HINT, USER_ROLE_LABEL } from '../lib/labels';
import { queryKeys } from '../lib/query-keys';
import { useDocumentTitle } from '../lib/use-document-title';

/** Invite someone to the workspace (docs/17 step 6). */
function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<InviteUserInput>({
    fullName: '',
    email: '',
    role: 'MEMBER',
  });
  const roleId = useId();

  const mutation = useMutation({
    mutationFn: () => api.inviteUser(input),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
  const errors = fieldErrorsOf(mutation.error);
  const failure =
    mutation.error && Object.keys(errors).length === 0 ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="Invite someone"
      onOpen={() => {
        setInput({ fullName: '', email: '', role: 'MEMBER' });
        mutation.reset();
      }}
      onSubmit={() => mutation.mutate()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <TextField
        label="Full name"
        required
        value={input.fullName}
        onChange={(event) => setInput({ ...input, fullName: event.target.value })}
        error={errors.fullName}
      />
      <TextField
        label="Email address"
        type="email"
        required
        value={input.email}
        onChange={(event) => setInput({ ...input, email: event.target.value })}
        error={errors.email}
      />
      <div className="space-y-1">
        <label htmlFor={roleId} className="block text-sm font-medium text-slate-800">
          Role
        </label>
        <select
          id={roleId}
          value={input.role}
          onChange={(event) => setInput({ ...input, role: event.target.value as UserRole })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {USER_ROLE_LABEL[role]}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">{USER_ROLE_HINT[input.role]}</p>
      </div>
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}

export function SettingsUsersPage() {
  useDocumentTitle('Users');
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<Confirmation | null>(null);

  const {
    data: users,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.listUsers,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });
  const roleMutation = useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: ChangeUserRoleInput }) =>
      api.changeUserRole(userId, input),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.removeUser(userId),
    onSuccess: refresh,
  });

  function removeUser(target: TenantUser) {
    setPending({
      title: `Remove ${target.fullName}?`,
      body: (
        <p>
          {target.fullName} will no longer be able to sign in. Documents they already sent are kept.
        </p>
      ),
      confirmLabel: 'Remove them',
      destructive: true,
      onConfirm: () => removeMutation.mutate(target.id),
    });
  }

  if (isLoading) return <EnvelopeDetailSkeleton />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-slate-600">
            Who can sign in to this workspace, and what they can do.
          </p>
        </div>
        <Button onClick={() => setInviting(true)}>Invite someone</Button>
      </div>

      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}
      {(roleMutation.error || removeMutation.error) && (
        <Alert>{describeError(roleMutation.error ?? removeMutation.error).message}</Alert>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        {(users ?? []).map((person) => {
          const isSelf = person.id === me?.id;
          return (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {person.fullName} {isSelf && <span className="text-slate-400">(you)</span>}
                </p>
                <p className="truncate text-xs text-slate-500">{person.email}</p>
                <p className="text-xs text-slate-400">
                  {person.lastLoginAt
                    ? `Last signed in ${formatDateTime(person.lastLoginAt)}`
                    : 'Never signed in'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="sr-only" htmlFor={`role-${person.id}`}>
                  Role for {person.fullName}
                </label>
                <select
                  id={`role-${person.id}`}
                  value={person.role}
                  disabled={isSelf || roleMutation.isPending}
                  onChange={(event) =>
                    roleMutation.mutate({
                      userId: person.id,
                      input: { role: event.target.value as UserRole },
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {USER_ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isSelf || removeMutation.isPending}
                  onClick={() => removeUser(person)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Remove ${person.fullName}`}
                  title={isSelf ? 'You cannot remove yourself' : `Remove ${person.fullName}`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
