import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicFrame } from '../../components/layout/PublicFrame';
import { BrandProvider } from './brand-context';

afterEach(cleanup);

function frame(brand: Parameters<typeof BrandProvider>[0]['brand']) {
  return render(
    <BrandProvider brand={brand}>
      <PublicFrame>
        <p>Body</p>
      </PublicFrame>
    </BrandProvider>,
  );
}

describe('BrandProvider', () => {
  it('keeps the product logo when the workspace set nothing', () => {
    frame({ name: 'Acme', color: null, logoUrl: null });
    expect(screen.getByText('Powered by HealthProHub')).toBeTruthy();
    expect(screen.queryByText(/Sent with/)).toBeNull();
  });

  it('shows the workspace logo, with attribution kept', () => {
    frame({ name: 'Acme Clinic', color: '#1d4ed8', logoUrl: '/api/v1/branding/logo/r1' });
    const logo = screen.getByRole('img', { name: 'Acme Clinic' });
    expect(logo.getAttribute('src')).toBe('/api/v1/branding/logo/r1');
    expect(screen.getByText(/Powered by HealthProHub/)).toBeTruthy();
  });

  it('shows the workspace name when only a colour is set', () => {
    frame({ name: 'Acme Clinic', color: '#1d4ed8', logoUrl: null });
    expect(screen.getByText('Acme Clinic')).toBeTruthy();
  });

  it('re-points the theme variables for everything inside', () => {
    const { container } = frame({ name: 'Acme', color: '#1d4ed8', logoUrl: null });
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--color-brand-700')).toBe('#1d4ed8');
  });

  it('sets nothing without a brand', () => {
    const { container } = frame(null);
    expect((container.firstElementChild as HTMLElement).getAttribute('style')).toBeNull();
  });
});
