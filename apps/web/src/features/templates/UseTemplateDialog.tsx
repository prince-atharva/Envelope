import { MAX_MESSAGE_LENGTH, type TemplateRoleInfo } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { names } from '../../lib/labels';
import { queryKeys } from '../../lib/query-keys';
import type { SentState } from '../sending/SendDialog';
import { roleKindLabel } from './templates-presentation';

interface Person {
  name: string;
  email: string;
}

/**
 * "Use template": one name and email for each role of the template, then a
 * draft to check, or the document sent at once. Nothing is sent until the
 * sender chooses it. One idempotency key is kept per open dialog, so pressing
 * the button again after a dropped connection does not make a second document.
 */
export function UseTemplateDialog({
  templateId,
  templateName,
  open,
  onClose,
}: {
  templateId: string;
  templateName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sendNow, setSendNow] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const keyRef = useRef<string>(crypto.randomUUID());
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messageId = useId();

  const template = useQuery({
    queryKey: queryKeys.template(templateId),
    queryFn: () => api.getTemplate(templateId),
    enabled: open,
  });
  const roles: TemplateRoleInfo[] = template.data?.roles ?? [];
  const personFor = (role: TemplateRoleInfo): Person => people[role.id] ?? { name: '', email: '' };
  const messageValue = message ?? template.data?.defaultMessage ?? '';

  const mutation = useMutation({
    mutationFn: () =>
      api.createFromTemplate(
        templateId,
        {
          recipients: roles.map((role) => ({
            role: role.name,
            name: personFor(role).name.trim(),
            email: personFor(role).email.trim(),
          })),
          message: messageValue.trim() === '' ? undefined : messageValue.trim(),
          send: sendNow,
        },
        keyRef.current,
      ),
    onSuccess: async (envelope) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.envelopes });
      if (sendNow) {
        const state: SentState = {
          sentTo: names(
            envelope.recipients
              .filter((recipient) => recipient.status === 'SENT')
              .map((recipient) => recipient.name),
          ),
        };
        await navigate(`/dashboard/envelopes/${envelope.id}`, { state });
      } else {
        await navigate(`/dashboard/envelopes/${envelope.id}/review`);
      }
    },
  });

  const failure = mutation.error ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={`Use “${templateName}”`}
      onOpen={() => {
        keyRef.current = crypto.randomUUID();
        setPeople({});
        setMessage(null);
        setSendNow(false);
        setClientError(null);
        mutation.reset();
      }}
      onSubmit={() => {
        if (roles.length === 0) return;
        const filled = roles.map(personFor);
        if (filled.some((person) => person.name.trim() === '' || person.email.trim() === '')) {
          return setClientError('Give every role a name and an email address.');
        }
        const emails = filled.map((person) => person.email.trim().toLowerCase());
        if (new Set(emails).size !== emails.length) {
          return setClientError('Each role needs a different email address.');
        }
        setClientError(null);
        mutation.mutate();
      }}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={template.isLoading || roles.length === 0}
          >
            {sendNow ? 'Create and send' : 'Create draft'}
          </Button>
        </>
      }
    >
      {template.isLoading && <p className="text-sm text-slate-600">Loading the template…</p>}
      {template.error && <Alert>{describeError(template.error).message}</Alert>}
      {roles.map((role) => (
        <fieldset key={role.id} className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            {role.name}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {roleKindLabel(role.role)}
            </span>
          </legend>
          <TextField
            label={`${role.name}: full name`}
            autoComplete="off"
            value={personFor(role).name}
            onChange={(event) =>
              setPeople({ ...people, [role.id]: { ...personFor(role), name: event.target.value } })
            }
          />
          <TextField
            label={`${role.name}: email address`}
            type="email"
            autoComplete="off"
            value={personFor(role).email}
            onChange={(event) =>
              setPeople({ ...people, [role.id]: { ...personFor(role), email: event.target.value } })
            }
          />
        </fieldset>
      ))}
      <div className="space-y-1">
        <label htmlFor={messageId} className="block text-sm font-medium text-slate-800">
          Message to include (optional)
        </label>
        <textarea
          id={messageId}
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH}
          value={messageValue}
          onChange={(event) => setMessage(event.target.value)}
          className="form-control w-full border px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">What next</legend>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name="template-next"
            checked={!sendNow}
            onChange={() => setSendNow(false)}
            className="mt-0.5"
          />
          <span>Save as a draft, so I can check it before it goes out</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name="template-next"
            checked={sendNow}
            onChange={() => setSendNow(true)}
            className="mt-0.5"
          />
          <span>Send it for signing now</span>
        </label>
      </fieldset>
      {clientError && <Alert>{clientError}</Alert>}
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}
