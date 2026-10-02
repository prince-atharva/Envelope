import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EndScreen } from './EndScreen';

function show(state: Parameters<typeof EndScreen>[0]['state'], hostName?: string) {
  render(
    <MemoryRouter>
      <EndScreen state={state} hostName={hostName} />
    </MemoryRouter>,
  );
}

describe('EndScreen', () => {
  afterEach(cleanup);

  it('tells someone who passed their part on that they are done, naming who holds it', () => {
    show({ kind: 'delegated', delegateName: 'Sam Lee' });
    expect(
      screen.getByRole('heading', { name: 'You passed this document to someone else' }),
    ).toBeTruthy();
    expect(screen.getByText(/Sam Lee has been emailed their own link/)).toBeTruthy();
  });

  it('explains an old link without naming anyone', () => {
    show({ kind: 'delegated' });
    expect(screen.getByText(/Someone else now holds your part/)).toBeTruthy();
  });

  it('asks a signer on the sender’s device to hand it back, after signing or declining', () => {
    show({ kind: 'signed', message: 'Done.' }, 'Hana Host');
    expect(screen.getByText('Please hand the device back to Hana Host.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Hana Host: sign in again' }).getAttribute('href'),
    ).toBe('/login');
    cleanup();
    show({ kind: 'you-declined', justNow: true }, 'Hana Host');
    expect(screen.getByText('Please hand the device back to Hana Host.')).toBeTruthy();
  });

  it('says nothing about a host when the signer used their own link', () => {
    show({ kind: 'signed', message: 'Done.' });
    expect(screen.queryByText(/hand the device back/)).toBeNull();
  });
});
