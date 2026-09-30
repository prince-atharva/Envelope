import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCodes } from './RecoveryCodes';

const CODES = ['abcde-23456', 'fghjk-78901'];

describe('RecoveryCodes', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists the codes and holds Continue back until they are confirmed saved', () => {
    const onDone = vi.fn();
    render(<RecoveryCodes codes={CODES} onDone={onDone} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(CODES);

    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I have saved these codes'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('copies all the codes, one per line, and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RecoveryCodes codes={CODES} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abcde-23456\nfghjk-78901'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
