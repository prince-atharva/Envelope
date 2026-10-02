import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InPersonBanner } from './InPersonBanner';

describe('InPersonBanner', () => {
  afterEach(cleanup);

  it('says whose device the signing is on, so the signer knows who is hosting', () => {
    render(<InPersonBanner hostName="Hana Host" />);
    expect(screen.getByRole('note').textContent).toBe('Signing in person, on Hana Host’s device');
  });
});
