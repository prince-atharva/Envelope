import { setEmbedOriginsSchema } from '@envelope/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';

export function EmbedOriginsPanel() {
  const id = useId();
  const queryClient = useQueryClient();
  const origins = useQuery({ queryKey: queryKeys.embedOrigins, queryFn: api.listEmbedOrigins });
  const [input, setInput] = useState<string | null>(null);
  const [validation, setValidation] = useState('');
  const mutation = useMutation({
    mutationFn: api.setEmbedOrigins,
    onSuccess: async () => {
      setInput(null);
      setValidation('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.embedOrigins });
    },
  });
  const error = origins.error ?? mutation.error;
  return (
    <Card as="section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Embedded editor origins
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Allow your application to open the document editor. Enter one exact HTTPS origin per line,
        up to 10. Removing an origin blocks its active sessions.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = setEmbedOriginsSchema.safeParse({
            origins: (input ?? origins.data?.join('\n') ?? '')
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          });
          if (!parsed.success) {
            setValidation(
              'Use unique exact HTTPS origins without paths or wildcards (maximum 10).',
            );
            return;
          }
          mutation.mutate(parsed.data.origins);
        }}
      >
        <label className="block text-sm font-medium" htmlFor={id}>
          Trusted parent origins
        </label>
        <textarea
          id={id}
          rows={3}
          className="w-full rounded-lg border border-slate-300 p-3 text-sm"
          placeholder="https://healthprohub.example"
          value={input ?? origins.data?.join('\n') ?? ''}
          onChange={(event) => {
            setInput(event.target.value);
            setValidation('');
          }}
          disabled={origins.isLoading || mutation.isPending}
        />
        {validation && <Alert>{validation}</Alert>}
        {error && <Alert>{describeError(error).message}</Alert>}
        <Button
          type="submit"
          className="min-h-11"
          loading={mutation.isPending}
          disabled={origins.isLoading || !!origins.error}
        >
          Save trusted origins
        </Button>
        {mutation.isSuccess && (
          <p role="status" className="text-sm text-emerald-700">
            Trusted origins saved.
          </p>
        )}
      </form>
    </Card>
  );
}
