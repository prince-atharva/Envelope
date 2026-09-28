import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { EmbedOriginsPanel } from './EmbedOriginsPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EmbedOriginsPanel />
    </QueryClientProvider>,
  );
}
describe('embedded origin management', () => {
  it('rejects wildcard input and submits exact origins', async () => {
    vi.spyOn(api, 'listEmbedOrigins').mockResolvedValue([]);
    const save = vi
      .spyOn(api, 'setEmbedOrigins')
      .mockResolvedValue(['https://healthprohub.example']);
    mount();
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Trusted parent origins') as HTMLTextAreaElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Trusted parent origins'), {
      target: { value: 'https://*.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save trusted origins' }));
    expect(screen.getByRole('alert').textContent).toContain('without paths or wildcards');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Trusted parent origins'), {
      target: { value: 'https://healthprohub.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save trusted origins' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(['https://healthprohub.example'], expect.anything()),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('saved'));
  });
});
