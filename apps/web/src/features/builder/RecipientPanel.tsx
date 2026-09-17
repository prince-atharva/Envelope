import {
  type AddRecipientInput,
  canOwnFields,
  type RecipientInfo,
  type RecipientRole,
} from '@envelope/shared';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { recipientColor } from './recipient-colors';

const ROLE_LABEL: Record<RecipientRole, string> = {
  SIGNER: 'Signs',
  APPROVER: 'Approves',
  VIEWER: 'Views only',
  CC: 'Gets a copy',
};

interface RecipientPanelProps {
  recipients: RecipientInfo[];
  activeRecipientId: string | null;
  fieldCounts: Map<string, number>;
  busy: boolean;
  sequentialSigning: boolean;
  onSelect: (recipientId: string) => void;
  onAdd: (input: AddRecipientInput) => Promise<void>;
  onChangeRole: (recipient: RecipientInfo, role: RecipientRole) => Promise<void>;
  onRemove: (recipient: RecipientInfo) => Promise<void>;
  onToggleSequential: (value: boolean) => Promise<void>;
}

export function RecipientPanel({
  recipients,
  activeRecipientId,
  fieldCounts,
  busy,
  sequentialSigning,
  onSelect,
  onAdd,
  onChangeRole,
  onRemove,
  onToggleSequential,
}: RecipientPanelProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sequentialId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onAdd({ name: name.trim(), email: email.trim(), role: 'SIGNER' });
      setName('');
      setEmail('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this person.');
    }
  }

  return (
    <section aria-labelledby="recipients-heading" className="space-y-3">
      <h2
        id="recipients-heading"
        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        People
      </h2>

      <ul className="space-y-2">
        {recipients.map((recipient, index) => {
          const color = recipientColor(recipient.colorIndex);
          const count = fieldCounts.get(recipient.id) ?? 0;
          const active = recipient.id === activeRecipientId;
          return (
            <li
              key={recipient.id}
              className={`rounded-lg border px-3 py-2 ${
                active ? 'border-brand-700 ring-1 ring-brand-700' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${color.swatch}`}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelect(recipient.id)}
                  aria-pressed={active}
                >
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {sequentialSigning ? `${index + 1}. ` : ''}
                    {recipient.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{recipient.email}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {ROLE_LABEL[recipient.role]}
                    {canOwnFields(recipient.role)
                      ? ` · ${count} field${count === 1 ? '' : 's'}`
                      : ''}
                  </span>
                </button>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <label className="sr-only" htmlFor={`role-${recipient.id}`}>
                  Role for {recipient.name}
                </label>
                <select
                  id={`role-${recipient.id}`}
                  value={recipient.role}
                  disabled={busy}
                  onChange={(event) => {
                    const role = event.target.value as RecipientRole;
                    const losesFields = !canOwnFields(role) && count > 0;
                    if (
                      losesFields &&
                      // A role that cannot sign has no use for fields, so the
                      // server deletes them. Say so before it happens.
                      !window.confirm(
                        `${recipient.name} has ${count} field${count === 1 ? '' : 's'}. ` +
                          `Someone who ${role === 'CC' ? 'only gets a copy' : 'only views'} cannot fill them in, so they will be removed.`,
                      )
                    ) {
                      event.target.value = recipient.role;
                      return;
                    }
                    void onChangeRole(recipient, role);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                >
                  {(Object.keys(ROLE_LABEL) as RecipientRole[]).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                  onClick={() => {
                    if (
                      count > 0 &&
                      !window.confirm(
                        `Remove ${recipient.name}? Their ${count} field${count === 1 ? '' : 's'} will go too.`,
                      )
                    ) {
                      return;
                    }
                    void onRemove(recipient);
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <TextField
          label="Name"
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Email address"
          type="email"
          value={email}
          required
          onChange={(event) => setEmail(event.target.value)}
          error={error ?? undefined}
        />
        <Button type="submit" loading={busy} className="w-full">
          Add person
        </Button>
      </form>

      <div className="flex items-center gap-2">
        <input
          id={sequentialId}
          type="checkbox"
          checked={sequentialSigning}
          disabled={busy}
          onChange={(event) => void onToggleSequential(event.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor={sequentialId} className="text-sm text-slate-700">
          Ask people one at a time, in order
        </label>
      </div>
    </section>
  );
}
