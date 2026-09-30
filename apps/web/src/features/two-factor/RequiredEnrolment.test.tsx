import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { RequiredEnrolment } from './RequiredEnrolment';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QUJD') },
}));

const SESSION = {
  accessToken: 'access',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u', email: 'a@b.co', fullName: 'A B', organization: null, role: 'MEMBER' },
};

describe('RequiredEnrolment', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('holds the session back until the recovery codes were shown, then adopts it', async () => {
    vi.spyOn(api, 'twoFactorEnrolStart').mockResolvedValue({
      secret: 'ABCDEFGHIJKLMNOP',
      otpauthUri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
    });
    vi.spyOn(api, 'twoFactorEnrolFinish').mockResolvedValue({
      ...SESSION,
      recoveryCodes: ['abcde-23456'],
    } as never);
    const adopt = vi.spyOn(api, 'adoptSession').mockImplementation(() => undefined);
    const onSignedIn = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RequiredEnrolment challengeToken="tok" onSignedIn={onSignedIn} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor' }));
    fireEvent.change(await screen.findByLabelText('Code from your app'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on and continue' }));

    expect(await screen.findByText('abcde-23456')).toBeTruthy();
    expect(api.twoFactorEnrolFinish).toHaveBeenCalledWith({
      challengeToken: 'tok',
      code: '123456',
    });
    // Not signed in yet: the codes have not been acknowledged.
    expect(adopt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I have saved these codes'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Envelope' }));
    expect(adopt).toHaveBeenCalledWith(SESSION);
    expect(onSignedIn).toHaveBeenCalled();
  });
});
