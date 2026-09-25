import type { ChangeUserRoleInput, InviteUserInput, TenantUser, UserRole } from '@envelope/shared';
import { USER_ROLES } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DialogShell } from '../components/ui/DialogShell';
import { TextField } from '../components/ui/Field';
import { UsersPageSkeleton } from '../components/ui/Skeletons';
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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
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

/** Avatar circle with initials — brand colour for self, slate for others. */
function UserAvatar({ name, isSelf }: { name: string; isSelf: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ring-white ${
        isSelf ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-700'
      }`}
      aria-hidden="true"
    >
      {initials}
    </div>
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

  if (isLoading) return <UsersPageSkeleton />;

  const totalUsers = (users ?? []).length;

  return (
    <div className="space-y-6 pb-8">
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />

      {/* Page Header — same structure as DashboardPage */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who can sign in to this workspace, and what they can do.
          </p>
        </div>
        <Button
          onClick={() => setInviting(true)}
          className="shadow-sm hover:shadow-md transition-shadow inline-flex items-center gap-2"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            />
          </svg>
          Invite someone
        </Button>
      </div>

      {/* Error alerts */}
      {error && (
        <Alert reference={describeError(error).reference}>{describeError(error).message}</Alert>
      )}
      {(roleMutation.error || removeMutation.error) && (
        <Alert>{describeError(roleMutation.error ?? removeMutation.error).message}</Alert>
      )}

      {/* Stats strip — same card style as dashboard empty-state steps */}
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {totalUsers} {totalUsers === 1 ? 'member' : 'members'}
          </p>
          <p className="text-xs text-slate-500">have access to this workspace</p>
        </div>
      </div>

      {/* User list — same card shape as dashboard document list */}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {(users ?? []).map((person) => {
          const isSelf = person.id === me?.id;
          return (
            <li
              key={person.id}
              className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              {/* Left: Avatar + Info */}
              <div className="flex items-center gap-4 min-w-0">
                <UserAvatar name={person.fullName} isSelf={isSelf} />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900 group-hover:text-brand-800 transition-colors">
                      {person.fullName}
                    </p>
                    {isSelf && (
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20">
                        you
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{person.email}</span>
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <svg
                        className="h-3 w-3 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      {person.lastLoginAt
                        ? `Last signed in ${formatDateTime(person.lastLoginAt)}`
                        : 'Never signed in'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Role + Remove — same right-side pattern as dashboard row */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 sm:justify-end sm:border-0 sm:pt-0">
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
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
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

      {/* Empty state — matching dashboard empty tab state */}
      {(users ?? []).length === 0 && !isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-900">No users yet</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
            Invite your team to collaborate in this workspace.
          </p>
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="mt-4 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
          >
            Invite someone →
          </button>
        </div>
      )}
    </div>
  );
}
