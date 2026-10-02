import {
  type EnvelopeDetail,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
} from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError, fieldErrorsOf } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import type { TemplatesPageState } from './templates-state';

/** Who becomes a role: a person who passed their part on is history, not a role (docs/22, ADR 0032). */
function templateParties(envelope: EnvelopeDetail): EnvelopeDetail['recipients'] {
  return envelope.recipients.filter((recipient) => recipient.status !== 'DELEGATED');
}

/** Whether the envelope has what a template needs: someone to sign, and somewhere to sign. */
export function canSaveAsTemplate(envelope: EnvelopeDetail): boolean {
  return templateParties(envelope).length > 0 && envelope.fields.length > 0 && !envelope.purgedAt;
}

/**
 * "Save as template" (docs/20, ADR 0027): the people on this document become
 * named roles ("Patient"), and the boxes stay where they are. The template keeps
 * its own copy of the PDF; nothing about this document changes.
 */
export function SaveTemplateDialog({
  envelope,
  open,
  onClose,
}: {
  envelope: EnvelopeDetail;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(envelope.title);
  const [description, setDescription] = useState('');
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const roleNameOf = (recipient: { id: string; name: string }) =>
    roleNames[recipient.id] ?? recipient.name;

  const mutation = useMutation({
    mutationFn: () =>
      api.saveTemplate({
        envelopeId: envelope.id,
        name: name.trim(),
        description: description.trim() === '' ? undefined : description.trim(),
        roleNames: Object.fromEntries(
          templateParties(envelope).map((recipient) => [
            recipient.id,
            roleNameOf(recipient).trim(),
          ]),
        ),
      }),
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      const state: TemplatesPageState = { saved: template.name };
      await navigate('/templates', { state });
    },
  });

  const errors = fieldErrorsOf(mutation.error);
  const failure =
    mutation.error && Object.keys(errors).length === 0 ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="Save as template"
      onOpen={() => {
        setName(envelope.title);
        setDescription('');
        setRoleNames({});
        setClientError(null);
        mutation.reset();
      }}
      onSubmit={() => {
        const roles = templateParties(envelope).map((recipient) => roleNameOf(recipient).trim());
        if (name.trim() === '') return setClientError('Give the template a name.');
        if (roles.some((role) => role === '')) return setClientError('Every role needs a name.');
        if (new Set(roles).size !== roles.length) {
          return setClientError('Each role needs a different name.');
        }
        setClientError(null);
        mutation.mutate();
      }}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save template
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        Anyone in your workspace can then send this document to new people in a few clicks. This
        document itself stays as it is.
      </p>
      <TextField
        label="Template name"
        required
        maxLength={MAX_TEMPLATE_NAME_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
      <TextField
        label="Description (optional)"
        maxLength={MAX_TEMPLATE_DESCRIPTION_LENGTH}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={errors.description}
      />
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-800">Who signs, by role</legend>
        <p className="text-xs text-slate-500">
          Name each role for what it is, such as “Patient”. You will give it a real person each time
          you use the template.
        </p>
        {templateParties(envelope).map((recipient) => (
          <TextField
            key={recipient.id}
            label={`Role for ${recipient.name}`}
            maxLength={200}
            value={roleNameOf(recipient)}
            onChange={(event) => setRoleNames({ ...roleNames, [recipient.id]: event.target.value })}
          />
        ))}
      </fieldset>
      {clientError && <Alert>{clientError}</Alert>}
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}
