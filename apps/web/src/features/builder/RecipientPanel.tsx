import {
  type AddRecipientInput,
  canOwnFields,
  needsFields,
  type RecipientInfo,
  type RecipientRole,
} from '@envelope/shared';
import { useId, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { type Confirmation, ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextField } from '../../components/ui/Field';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '../../components/ui/icons';
import { describeError } from '../../lib/errors';
import { ROLE_LABEL } from '../../lib/labels';
import { recipientColor } from './recipient-colors';
import { isGroupedWithPrevious } from './recipient-order';

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
  onMove: (recipient: RecipientInfo, direction: 'up' | 'down') => Promise<void>;
  onToggleSequential: (value: boolean) => Promise<void>;
  /** Groups a recipient with the person above them, so they sign at the same
   * time (mixed routing, docs/17 step 11), or ungroups them. */
  onToggleGrouped: (recipient: RecipientInfo) => Promise<void>;
}

const SIGNING_ORDER_OPTIONS = [
  {
    sequential: false,
    label: 'Everyone at once',
    hint: 'All signers get the link together and can sign in any order.',
  },
  {
    sequential: true,
    label: 'One after another',
    hint: 'Signer 1 signs first. Signer 2 is invited only once Signer 1 is done.',
  },
] as const;

function fieldNoun(count: number): string {
  return count === 1 ? 'field' : 'fields';
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
  onMove,
  onToggleSequential,
  onToggleGrouped,
}: RecipientPanelProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Confirmation | null>(null);
  const orderId = useId();
  const headingId = useId();
  const showOrder = sequentialSigning && recipients.length > 1;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onAdd({ name: name.trim(), email: email.trim(), role: 'SIGNER' });
      setName('');
      setEmail('');
    } catch (cause) {
      setError(describeError(cause).message);
    }
  }

  /** A role that cannot hold fields silently discards them, so we ask first. */
  function changeRole(recipient: RecipientInfo, role: RecipientRole, count: number) {
    if (canOwnFields(role) || count === 0) {
      void onChangeRole(recipient, role);
      return;
    }
    setPending({
      title: `Move ${recipient.name} to "${ROLE_LABEL[role]}"?`,
      body: (
        <p>
          {recipient.name} has {count} {fieldNoun(count)} on this document. Someone who{' '}
          {role === 'CC' ? 'only gets a copy' : 'only views it'} cannot fill them in, so those{' '}
          {fieldNoun(count)} will be removed.
        </p>
      ),
      confirmLabel: `Change role and remove ${count} ${fieldNoun(count)}`,
      destructive: true,
      onConfirm: () => void onChangeRole(recipient, role),
    });
  }

  function remove(recipient: RecipientInfo, count: number) {
    if (count === 0) {
      void onRemove(recipient);
      return;
    }
    setPending({
      title: `Remove ${recipient.name}?`,
      body: (
        <p>
          The {count} {fieldNoun(count)} placed for {recipient.name} will be removed from the
          document as well.
        </p>
      ),
      confirmLabel: 'Remove them',
      destructive: true,
      onConfirm: () => void onRemove(recipient),
    });
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />

      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div>
          <h2 id={headingId} className="section-title">
            Recipients &amp; roles
          </h2>
          <p className="text-xs text-slate-500">People who will sign or view this document.</p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-brand-200/60 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      <ul className="space-y-2">
        {recipients.map((recipient, index) => {
          const color = recipientColor(recipient.colorIndex);
          const count = fieldCounts.get(recipient.id) ?? 0;
          const active = recipient.id === activeRecipientId;
          return (
            <li
              key={recipient.id}
              className={`rounded-xl border p-3 transition-all ${
                active
                  ? 'border-brand-600 bg-brand-50/40 shadow-xs ring-1 ring-brand-600/30'
                  : 'border-slate-200/90 bg-white  hover:border-slate-300'
              }`}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white  ${color.swatch}`}
                  aria-hidden="true"
                >
                  {sequentialSigning ? index + 1 : recipient.name.charAt(0).toUpperCase()}
                </div>

                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  onClick={() => onSelect(recipient.id)}
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between gap-1">
                    {/* The number is part of the text, not only the swatch: the
                        order has to be readable without seeing the colour. */}
                    <span className="truncate text-xs font-bold text-slate-900">
                      {sequentialSigning ? `${index + 1}. ${recipient.name}` : recipient.name}
                    </span>
                    {active && (
                      <span className="shrink-0 rounded bg-brand-100/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-brand-700">
                        Active
                      </span>
                    )}
                  </div>
                  <span className="block truncate text-xs text-slate-500">{recipient.email}</span>
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                      {ROLE_LABEL[recipient.role]}
                    </span>
                    {canOwnFields(recipient.role) &&
                      (count === 0 && !needsFields(recipient.role) ? (
                        // An approver can approve without fields, so none is not a warning.
                        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-500">
                          No fields needed
                        </span>
                      ) : (
                        <span
                          className={`rounded px-1.5 py-0.5 font-semibold ${
                            count > 0
                              ? 'border border-emerald-200/60 bg-emerald-50 text-emerald-700'
                              : 'border border-amber-200/60 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {count} {fieldNoun(count)}
                        </span>
                      ))}
                  </div>
                </button>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                <div className="flex items-center gap-1.5">
                  <label className="sr-only" htmlFor={`role-${recipient.id}`}>
                    Role for {recipient.name}
                  </label>
                  <select
                    id={`role-${recipient.id}`}
                    value={recipient.role}
                    disabled={busy}
                    onChange={(event) =>
                      changeRole(recipient, event.target.value as RecipientRole, count)
                    }
                    className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {(Object.keys(ROLE_LABEL) as RecipientRole[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  {showOrder && (
                    <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
                      <IconButton
                        label={`Move ${recipient.name} up`}
                        title="Move earlier in order"
                        disabled={busy || index === 0}
                        onClick={() => void onMove(recipient, 'up')}
                      >
                        <ChevronUpIcon className="h-4 w-4" strokeWidth={2.5} />
                      </IconButton>
                      <IconButton
                        label={`Move ${recipient.name} down`}
                        title="Move later in order"
                        disabled={busy || index === recipients.length - 1}
                        onClick={() => void onMove(recipient, 'down')}
                      >
                        <ChevronDownIcon className="h-4 w-4" strokeWidth={2.5} />
                      </IconButton>
                    </div>
                  )}

                  {showOrder && index > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={isGroupedWithPrevious(recipients, recipient.id)}
                      aria-label={
                        isGroupedWithPrevious(recipients, recipient.id)
                          ? `${recipient.name} signs at the same time as the person above; click to give them their own turn`
                          : `Let ${recipient.name} sign at the same time as the person above`
                      }
                      title="Sign at the same time as the person above"
                      className={`rounded-lg border p-1.5 text-xs font-semibold  transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        isGroupedWithPrevious(recipients, recipient.id)
                          ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                      onClick={() => void onToggleGrouped(recipient)}
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                        />
                      </svg>
                    </button>
                  )}

                  <IconButton
                    label={`Remove ${recipient.name}`}
                    tone="danger"
                    disabled={busy}
                    onClick={() => remove(recipient, count)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Always open. Collapsing it after each add made a three-signer
          document a click-per-person slower, for no gain on a panel this
          short. */}
      <form
        onSubmit={submit}
        className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5"
      >
        <span className="block text-xs font-bold text-slate-800">
          {recipients.length === 0 ? 'Add the first recipient' : 'Add another recipient'}
        </span>
        <TextField
          label="Name"
          value={name}
          required
          placeholder="e.g. Alex Morgan"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Email address"
          type="email"
          value={email}
          required
          placeholder="alex@example.com"
          onChange={(event) => setEmail(event.target.value)}
          error={error ?? undefined}
        />
        <Button type="submit" size="sm" loading={busy} className="w-full">
          Add person
        </Button>
      </form>

      <fieldset className="space-y-2 border-t border-slate-100 pt-3">
        <legend className="section-title">Signing order</legend>
        <div className="space-y-1.5">
          {SIGNING_ORDER_OPTIONS.map((option) => {
            const inputId = `${orderId}-${option.sequential ? 'sequential' : 'parallel'}`;
            const checked = sequentialSigning === option.sequential;
            return (
              <label
                key={inputId}
                htmlFor={inputId}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-all ${
                  checked
                    ? 'border-brand-600 bg-brand-50/40  ring-1 ring-brand-600/30'
                    : 'border-slate-200/90 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={orderId}
                  checked={checked}
                  disabled={busy}
                  onChange={() => void onToggleSequential(option.sequential)}
                  className="mt-0.5 h-3.5 w-3.5 text-brand-600 focus:ring-brand-500"
                />
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-slate-900">{option.label}</span>
                  <span className="block text-xs leading-snug text-slate-500">{option.hint}</span>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
