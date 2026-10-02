import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EndScreen } from './EndScreen';

function show(state: Parameters<typeof EndScreen>[0]['state']) {
  render(
    <MemoryRouter>
      <EndScreen state={state} />
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

  it('says nothing about a host when the signer used their own link', () => {
    show({ kind: 'signed', message: 'Done.' });
    expect(screen.queryByText(/hand the device back/)).toBeNull();
  });
});
