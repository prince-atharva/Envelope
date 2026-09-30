import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { PasswordSection } from './PasswordSection';

function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PasswordSection />
    </QueryClientProvider>,
  );
}

function fill(current: string, next: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('PasswordSection', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sends both passwords, says the other devices were signed out and clears the form', async () => {
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue(undefined);
    renderSection();
    fill('the old password', 'a brand new password');

    expect((await screen.findByRole('status')).textContent).toContain(
      'other devices were signed out',
    );
    expect(change).toHaveBeenCalledWith({
      currentPassword: 'the old password',
      newPassword: 'a brand new password',
    });
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });

  it('stops a short or unchanged password before it is sent', () => {
    const change = vi.spyOn(api, 'changePassword');
    renderSection();
    fill('the old password', 'short');
    expect(screen.getByText('Use at least 12 characters', { selector: 'p' })).toBeTruthy();
    fill('a brand new password', 'a brand new password');
    expect(screen.getByText('Choose a password you are not already using')).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  it('shows a wrong current password on that field', async () => {
    vi.spyOn(api, 'changePassword').mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'CURRENT_PASSWORD_INCORRECT',
        title: 'Current password is incorrect',
      }),
    );
    renderSection();
    fill('not my password', 'a brand new password');

    expect(await screen.findByText('That is not your current password.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
