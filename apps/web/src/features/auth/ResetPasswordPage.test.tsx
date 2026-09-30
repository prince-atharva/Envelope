import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import ResetPasswordPage from './ResetPasswordPage';

const TOKEN = 'c'.repeat(64);

function LoginProbe() {
  const state = useLocation().state as { passwordChanged?: boolean } | null;
  return <p>login page, changed={String(state?.passwordChanged)}</p>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/reset-password/${TOKEN}`]}>
        <Routes>
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          <Route path="/login" element={<LoginProbe />} />
          <Route path="/forgot-password" element={<p>forgot page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PREVIEW = { email: 'a***@example.com', expiresAt: '2026-10-01T10:00:00.000Z' };

describe('ResetPasswordPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('names the masked account, then sends the person to sign in with a notice', async () => {
    vi.spyOn(api, 'passwordResetPreview').mockResolvedValue(PREVIEW);
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByText(/Choose a new password for a\*\*\*@example\.com/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a brand new password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('login page, changed=true')).toBeTruthy();
    expect(reset).toHaveBeenCalledWith(TOKEN, { password: 'a brand new password' });
  });

  it('holds a short password back with the policy message and does not call the server', async () => {
    vi.spyOn(api, 'passwordResetPreview').mockResolvedValue(PREVIEW);
    const reset = vi.spyOn(api, 'resetPassword');
    renderPage();

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByText('Use at least 12 characters', { selector: 'p' })).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();
  });

  it('shows a server refusal without leaving the page', async () => {
    vi.spyOn(api, 'passwordResetPreview').mockResolvedValue(PREVIEW);
    vi.spyOn(api, 'resetPassword').mockRejectedValue(
      new ApiError({
        status: 401,
        code: 'PASSWORD_RESET_TOKEN_INVALID',
        title: 'Invalid or already-used reset link',
      }),
    );
    renderPage();

    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'a brand new password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect((await screen.findByRole('alert')).textContent).toContain('not valid');
    expect(screen.queryByText(/login page/)).toBeNull();
  });

  it.each([
    ['PASSWORD_RESET_TOKEN_EXPIRED', 'This link has expired'],
    ['PASSWORD_RESET_TOKEN_INVALID', 'This link is not valid'],
  ] as const)('explains a %s link and offers a new one', async (code, heading) => {
    vi.spyOn(api, 'passwordResetPreview').mockRejectedValue(
      new ApiError({ status: 401, code, title: 'x' }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Send me a new link' }));
    expect(await screen.findByText('forgot page')).toBeTruthy();
  });
});
