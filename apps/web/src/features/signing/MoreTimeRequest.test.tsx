import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoreTimeRequest } from './MoreTimeRequest';
import { signingApi } from './signing-api';

const TOKEN = 'a'.repeat(64);

function renderRequest() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MoreTimeRequest token={TOKEN} />
    </QueryClientProvider>,
  );
}

describe('MoreTimeRequest', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('asks once and says what happens next', async () => {
    const ask = vi
      .spyOn(signingApi, 'requestMoreTime')
      .mockResolvedValue({ requested: true, alreadyRequested: false });
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for more time' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'We have asked the sender for more time. If they give it, you will get a new email',
    );
    expect(ask).toHaveBeenCalledWith(TOKEN);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('treats a repeat request as done, not as an error', async () => {
    vi.spyOn(signingApi, 'requestMoreTime').mockResolvedValue({
      requested: true,
      alreadyRequested: true,
    });
    renderRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for more time' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'You have already asked today',
    );
  });
});
