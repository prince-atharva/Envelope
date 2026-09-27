import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export function useOneTimeSecretMutation<Input, Summary>({
  create,
  onSuccess,
}: {
  create: (input: Input) => Promise<{ summary: Summary; rawValue: string }>;
  onSuccess: () => Promise<unknown>;
}) {
  const [rawValue, setRawValue] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const mutation = useMutation({
    mutationFn: async ({ input, current }: { input: Input; current: number }) => {
      if (current !== generation.current) throw new Error('Credential creation cancelled');
      const result = await create(input);
      if (current === generation.current) setRawValue(result.rawValue);
      // Phase 7 (docs/18): mutation caches must receive only safe metadata.
      return result.summary;
    },
    onSuccess,
  });
  const reset = () => {
    generation.current += 1;
    setRawValue(null);
    mutation.reset();
  };
  return {
    ...mutation,
    rawValue,
    reset,
    mutate: (input: Input) => mutation.mutate({ input, current: generation.current }),
    mutateAsync: (input: Input) => mutation.mutateAsync({ input, current: generation.current }),
  };
}
