import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { TwoFactorSection } from './TwoFactorSection';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QUJD') },
}));

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TwoFactorSection />
    </QueryClientProvider>,
  );
}

describe('TwoFactorSection', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers setup when it is off, and shows the recovery codes once it is on', async () => {
    const status = vi
      .spyOn(api, 'twoFactorStatus')
      .mockResolvedValueOnce({ enabled: false, recoveryCodesRemaining: 0, required: false })
      .mockResolvedValue({ enabled: true, recoveryCodesRemaining: 10, required: false });
    vi.spyOn(api, 'twoFactorSetup').mockResolvedValue({
      secret: 'ABCDEFGHIJKLMNOP',
      otpauthUri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
    });
    vi.spyOn(api, 'twoFactorEnable').mockResolvedValue({ recoveryCodes: ['abcde-23456'] });
    renderSection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up two-factor authentication' }),
    );
    fireEvent.change(await screen.findByLabelText('Code from your app'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText('abcde-23456')).toBeTruthy();
    expect(api.twoFactorEnable).toHaveBeenCalledWith({ code: '123456' });
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByLabelText('I have saved these codes'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Two-factor authentication is on.')).toBeTruthy();
    expect(screen.getByText(/10 unused recovery codes left/)).toBeTruthy();
  });

  it('turns it off only with the password and a code', async () => {
    vi.spyOn(api, 'twoFactorStatus')
      .mockResolvedValueOnce({ enabled: true, recoveryCodesRemaining: 3, required: false })
      .mockResolvedValue({ enabled: false, recoveryCodesRemaining: 0, required: false });
    const disable = vi.spyOn(api, 'twoFactorDisable').mockResolvedValue(undefined);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-factor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-factor' }));
    expect(disable).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'the password' } });
    fireEvent.change(screen.getByLabelText('Code or recovery code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-factor' }));
    await waitFor(() =>
      expect(disable).toHaveBeenCalledWith({ password: 'the password', code: '123456' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Set up two-factor authentication' }),
    ).toBeTruthy();
  });

  it('does not offer to turn it off when the workspace requires it', async () => {
    vi.spyOn(api, 'twoFactorStatus').mockResolvedValue({
      enabled: true,
      recoveryCodesRemaining: 10,
      required: true,
    });
    renderSection();
    expect(await screen.findByText('Two-factor authentication is on.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn off two-factor' })).toBeNull();
    expect(screen.getByText(/requires it, so it cannot be turned off/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show new recovery codes' })).toBeTruthy();
  });
});
