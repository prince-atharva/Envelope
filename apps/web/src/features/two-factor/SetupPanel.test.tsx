import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { SetupPanel } from './SetupPanel';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QUJD') },
}));

const SETUP = {
  secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  otpauthUri:
    'otpauth://totp/Envelope:a%40b.co?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Envelope',
};

function renderPanel(onConfirm: (code: string) => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SetupPanel setup={SETUP} onConfirm={onConfirm} />
    </QueryClientProvider>,
  );
}

describe('SetupPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('draws the QR code in the browser and offers the key in groups of four', async () => {
    renderPanel(async () => undefined);
    const img = await screen.findByAltText('QR code for your authenticator app');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QUJD');
    expect(screen.getByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeTruthy();
  });

  it('sends only a six-digit code, and not before it looks like one', async () => {
    const onConfirm = vi.fn(async () => undefined);
    renderPanel(onConfirm);
    fireEvent.change(screen.getByLabelText('Code from your app'), { target: { value: '12ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(screen.getByText('Enter the 6-digit code from your authenticator app')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Code from your app'), {
      target: { value: ' 123456 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('123456'));
  });

  it('shows the server refusal and keeps the form', async () => {
    renderPanel(async () => {
      throw new ApiError({
        status: 422,
        code: 'TWO_FACTOR_CODE_INVALID',
        title: 'That code is not valid',
      });
    });
    fireEvent.change(screen.getByLabelText('Code from your app'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect((await screen.findByRole('alert')).textContent).toContain('That code is not valid');
    expect(screen.getByLabelText('Code from your app')).toBeTruthy();
  });
});
