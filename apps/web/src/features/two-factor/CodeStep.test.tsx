import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { CodeStep } from './CodeStep';

describe('CodeStep', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sends the challenge token and the six-digit code', async () => {
    const complete = vi.spyOn(api, 'completeTwoFactor').mockResolvedValue({} as never);
    render(<CodeStep challengeToken="tok" onBack={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({ challengeToken: 'tok', code: '123456' }),
    );
  });

  it('switches to a recovery code and back, clearing what was typed', () => {
    render(<CodeStep challengeToken="tok" onBack={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    const field = screen.getByLabelText('Recovery code') as HTMLInputElement;
    expect(field.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Use my authenticator app' }));
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
  });

  it('does not call the server for something that is not a code', () => {
    const complete = vi.spyOn(api, 'completeTwoFactor');
    render(<CodeStep challengeToken="tok" onBack={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter the 6-digit code.');
    expect(complete).not.toHaveBeenCalled();
  });

  it('shows a wrong code and an expired sign-in, and can go back', async () => {
    const onBack = vi.fn();
    const complete = vi
      .spyOn(api, 'completeTwoFactor')
      .mockRejectedValueOnce(
        new ApiError({ status: 422, code: 'TWO_FACTOR_CODE_INVALID', title: 'x' }),
      )
      .mockRejectedValueOnce(
        new ApiError({ status: 401, code: 'TWO_FACTOR_CHALLENGE_INVALID', title: 'x' }),
      );
    render(<CodeStep challengeToken="tok" onBack={onBack} />);
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect((await screen.findByRole('alert')).textContent).toContain('That code is not valid');

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toContain('sign-in timed out');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalled();
  });
});
