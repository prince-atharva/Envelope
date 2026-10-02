import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { DelegateDialog } from './DelegateDialog';
import { signingApi } from './signing-api';

// jsdom has no modal <dialog>; the sheet only needs it to open.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

function show(onEnd = vi.fn(), onClose = vi.fn()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <DelegateDialog
        open
        token={'a'.repeat(64)}
        senderName="Dana"
        onClose={onClose}
        onEnd={onEnd}
      />
    </QueryClientProvider>,
  );
  return { onEnd, onClose };
}

describe('DelegateDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('says what will happen before anything is sent', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Pass this to someone else?' })).toBeTruthy();
    expect(screen.getByText(/Your link will stop working, and Dana will be told/)).toBeTruthy();
  });

  it('asks for both a name and an address, and sends nothing without them', () => {
    const delegate = vi.spyOn(signingApi, 'delegate');
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Pass it on' }));
    expect(screen.getByText('Enter their name and email address.')).toBeTruthy();
    expect(delegate).not.toHaveBeenCalled();
  });

  it('ends on the passed-on screen, naming who now holds it', async () => {
    vi.spyOn(signingApi, 'delegate').mockResolvedValue({
      status: 'DELEGATED',
      delegatedAt: '2026-10-01T10:00:00Z',
      delegateName: 'Sam Lee',
    });
    const { onEnd } = show();
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: ' Sam Lee ' } });
    fireEvent.change(screen.getByLabelText('Their email address'), {
      target: { value: 'sam@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass it on' }));
    await waitFor(() =>
      expect(onEnd).toHaveBeenCalledWith({ kind: 'delegated', delegateName: 'Sam Lee' }),
    );
    expect(signingApi.delegate).toHaveBeenCalledWith('a'.repeat(64), {
      name: 'Sam Lee',
      email: 'sam@example.com',
    });
  });

  it('keeps the dialog open and explains when that person is already on the document', async () => {
    vi.spyOn(signingApi, 'delegate').mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'RECIPIENT_EMAIL_TAKEN',
        title: 'That person is already on this envelope',
        detail: 'That person is already on this document.',
      }),
    );
    const { onEnd } = show();
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Ben' } });
    fireEvent.change(screen.getByLabelText('Their email address'), {
      target: { value: 'ben@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass it on' }));
    await waitFor(() => expect(screen.getByText(/already on this document/)).toBeTruthy());
    expect(onEnd).not.toHaveBeenCalled();
  });
});
