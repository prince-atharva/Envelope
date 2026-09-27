import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOneTimeSecretMutation } from './use-one-time-secret-mutation';

function setup(create: () => Promise<{ summary: { id: string }; rawValue: string }>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const hook = renderHook(
    () => useOneTimeSecretMutation<void, { id: string }>({ create, onSuccess: async () => {} }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...hook, client };
}

describe('one-time credential creation', () => {
  it('keeps raw credentials out of the mutation cache and clears on close', async () => {
    const { result, client, unmount } = setup(async () => ({
      summary: { id: 'key' },
      rawValue: 'secret',
    }));
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(result.current.rawValue).toBe('secret');
    expect(
      client
        .getMutationCache()
        .getAll()
        .map((entry) => entry.state.data),
    ).toEqual([{ id: 'key' }]);
    act(() => result.current.reset());
    expect(result.current.rawValue).toBeNull();
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain('secret');
    unmount();
    client.clear();
  });

  it('discards a response arriving after close and reopen', async () => {
    let resolve!: (value: { summary: { id: string }; rawValue: string }) => void;
    const response = new Promise<{ summary: { id: string }; rawValue: string }>((done) => {
      resolve = done;
    });
    const { result, client, unmount } = setup(() => response);
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => {
      result.current.reset();
      result.current.reset();
    });
    await act(async () => {
      resolve({ summary: { id: 'late' }, rawValue: 'late-secret' });
      await response;
    });
    expect(result.current.rawValue).toBeNull();
    await waitFor(() =>
      expect(client.getMutationCache().getAll()[0]?.state.status).toBe('success'),
    );
    expect(client.getMutationCache().getAll()[0]?.state.data).toEqual({ id: 'late' });
    unmount();
    client.clear();
  });
  it('cancels creation closed before the mutation function starts', async () => {
    const create = vi.fn(async () => ({ summary: { id: 'key' }, rawValue: 'secret' }));
    const { result, client, unmount } = setup(create);
    act(() => {
      result.current.mutate();
      result.current.reset();
    });
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    expect(create).not.toHaveBeenCalled();
    expect(result.current.rawValue).toBeNull();
    unmount();
    client.clear();
  });

  it('cancels offline creation when the dialog closes before reconnection', async () => {
    const create = vi.fn(async () => ({ summary: { id: 'key' }, rawValue: 'secret' }));
    const { result, client, unmount } = setup(create);
    onlineManager.setOnline(false);
    try {
      act(() => result.current.mutate());
      await waitFor(() => expect(result.current.isPaused).toBe(true));
      act(() => result.current.reset());
      onlineManager.setOnline(true);
      await waitFor(() =>
        expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'),
      );
      expect(create).not.toHaveBeenCalled();
      expect(result.current.rawValue).toBeNull();
    } finally {
      onlineManager.setOnline(true);
      unmount();
      client.clear();
    }
  });
});
