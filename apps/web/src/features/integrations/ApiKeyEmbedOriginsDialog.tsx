import type { ApiKeySummary } from '@envelope/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { parseOriginsInput, removedOrigins } from './api-key-origins-form';

/**
 * Origins belong to the key that issues sessions, not the workspace as a
 * whole (docs/18 workstream 7, ADR 0017): editing here never touches another
 * key's permissions. Removing an origin is a second, explicit step, since it
 * ends that origin's live editor sessions on their next request.
 */
export function ApiKeyEmbedOriginsDialog({
  apiKey,
  open,
  onClose,
}: {
  apiKey: ApiKeySummary | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const mutation = useMutation({
    mutationFn: (origins: string[]) => api.setApiKeyEmbedOrigins(apiKey?.id ?? '', origins),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
      onClose();
    },
  });
  const close = () => {
    onClose();
    setRemoving(null);
    setErrors([]);
  };

  return (
    <DialogShell
      open={open}
      title={removing ? 'Remove access for these origins?' : `Embedded editor origins`}
      onClose={close}
      onOpen={() => {
        setText((apiKey?.embedOrigins ?? []).join('\n'));
        setErrors([]);
        setRemoving(null);
        mutation.reset();
      }}
      onSubmit={() => {
        if (removing) {
          mutation.mutate(parseOriginsInput(text).origins);
          return;
        }
        const parsed = parseOriginsInput(text);
        if (parsed.errors.length > 0) {
          setErrors(parsed.errors);
          return;
        }
        setErrors([]);
        const removed = removedOrigins(apiKey?.embedOrigins ?? [], parsed.origins);
        if (removed.length > 0) {
          setRemoving(removed);
          return;
        }
        mutation.mutate(parsed.origins);
      }}
      actions={
        removing ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setRemoving(null)}
              disabled={mutation.isPending}
            >
              Go back
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending}>
              Remove and save
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save origins
            </Button>
          </>
        )
      }
    >
      {removing ? (
        <p className="text-sm text-slate-600">
          {apiKey?.label ?? 'This key'} will no longer open its editor from{' '}
          <strong>{removing.join(', ')}</strong>. Any live session opened from there stops working
          on its next request. This cannot be undone.
        </p>
      ) : (
        <>
          <label className="block text-sm font-medium" htmlFor={fieldId}>
            {apiKey?.label ?? 'This key'}’s embedded editor origins
          </label>
          <p className="text-sm text-slate-600">
            One exact HTTPS origin per line, up to 10. An empty list makes this key backend-only: it
            can still call the server API, but cannot open the embedded editor.
          </p>
          <textarea
            id={fieldId}
            rows={4}
            className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            placeholder="https://healthprohub.example"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setErrors([]);
            }}
            disabled={mutation.isPending}
          />
          {errors.map((message) => (
            <Alert key={message}>{message}</Alert>
          ))}
          {mutation.error && <Alert>{describeError(mutation.error).message}</Alert>}
        </>
      )}
    </DialogShell>
  );
}
