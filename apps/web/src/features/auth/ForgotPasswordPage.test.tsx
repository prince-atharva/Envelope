import { FORGOT_PASSWORD_MESSAGE } from '@envelope/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { ForgotPasswordPage } from './ForgotPasswordPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('ForgotPasswordPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('asks for the address, then shows the same answer whatever the server said', async () => {
    const ask = vi
      .spyOn(api, 'forgotPassword')
      .mockResolvedValue({ message: FORGOT_PASSWORD_MESSAGE });
    renderPage();
    submit('  Asha@Example.com ');

    expect((await screen.findByRole('status')).textContent).toBe(FORGOT_PASSWORD_MESSAGE);
    expect(ask).toHaveBeenCalledWith({ email: 'asha@example.com' });
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/login',
    );
  });

  it('does not call the server for something that is not an email address', () => {
    const ask = vi.spyOn(api, 'forgotPassword');
    renderPage();
    submit('not-an-email');
    expect(screen.getByRole('alert').textContent).toBe('Enter the email address of your account.');
    expect(ask).not.toHaveBeenCalled();
  });

  it('says to wait when the request limit is reached', async () => {
    vi.spyOn(api, 'forgotPassword').mockRejectedValue(
      new ApiError({ status: 429, code: 'RATE_LIMITED', title: 'Too many requests' }),
    );
    renderPage();
    submit('asha@example.com');
    expect((await screen.findByRole('alert')).textContent).toContain('wait an hour');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy();
  });
});
