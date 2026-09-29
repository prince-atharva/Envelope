import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PartnerReference } from './PartnerReference';

describe('PartnerReference', () => {
  afterEach(cleanup);

  it('shows nothing when the document has no reference', () => {
    const { container } = render(<PartnerReference externalId={null} metadata={null} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows the id and each label', () => {
    render(
      <PartnerReference
        externalId="visit:1001"
        metadata={{ department: 'billing', form: 'consent-v3' }}
      />,
    );
    const group = screen.getByRole('group', { name: 'Partner reference' });
    expect(group.textContent).toContain('Reference visit:1001');
    expect(group.textContent).toContain('department: billing');
    expect(group.textContent).toContain('form: consent-v3');
  });

  it('shows labels without an id, and an id without labels', () => {
    render(<PartnerReference externalId={null} metadata={{ a: 'b' }} />);
    expect(screen.getByRole('group').textContent).toBe('a: b');
    cleanup();
    render(<PartnerReference externalId="r-1" metadata={{}} />);
    expect(screen.getByRole('group').textContent).toBe('Reference r-1');
  });

  it('renders markup in a value as plain text', () => {
    render(
      <PartnerReference externalId={null} metadata={{ note: '<img src=x onerror=alert(1)>' }} />,
    );
    expect(screen.getByRole('group').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});
