import {
  MAX_MESSAGE_LENGTH,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  type TemplateSummary,
} from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { TextField } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError, fieldErrorsOf } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';

/** Renaming and describing a template, and the note its invitations carry (Admins). */
export function EditTemplateDialog({
  template,
  open,
  onClose,
}: {
  template: TemplateSummary;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const messageId = useId();

  const detail = useQuery({
    queryKey: queryKeys.template(template.id),
    queryFn: () => api.getTemplate(template.id),
    enabled: open,
  });
  const messageValue = message ?? detail.data?.defaultMessage ?? '';

  const mutation = useMutation({
    mutationFn: () =>
      api.updateTemplate(template.id, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        defaultMessage: messageValue.trim() === '' ? null : messageValue.trim(),
      }),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
  const errors = fieldErrorsOf(mutation.error);
  const failure =
    mutation.error && Object.keys(errors).length === 0 ? describeError(mutation.error) : null;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="Edit template details"
      onOpen={() => {
        setName(template.name);
        setDescription(template.description ?? '');
        setMessage(null);
        mutation.reset();
      }}
      onSubmit={() => mutation.mutate()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={detail.isLoading}>
            Save details
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        The document, its roles and where people sign cannot be changed. To change those, save a new
        template and archive this one.
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
      <div className="space-y-1">
        <label htmlFor={messageId} className="block text-sm font-medium text-slate-800">
          Message included with every invitation (optional)
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
      {failure && <Alert reference={failure.reference}>{failure.message}</Alert>}
    </DialogShell>
  );
}
