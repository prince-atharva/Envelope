import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollToTop } from './ScrollToTop';

describe('ScrollToTop', () => {
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    cleanup();
    vi.restoreAllMocks();
  });

  it('scrolls to top on mount', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  });

  it('sets history scrollRestoration to manual if supported', () => {
    Object.defineProperty(window.history, 'scrollRestoration', {
      value: 'auto',
      writable: true,
      configurable: true,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.history.scrollRestoration).toBe('manual');
  });
});
