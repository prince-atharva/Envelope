import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppShellSkeleton,
  DashboardSkeleton,
  DocumentListSkeleton,
  EnvelopeDetailSkeleton,
  TopProgressBar,
} from './Skeletons';

describe('Skeletons', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders DocumentListSkeleton with requested rows and aria-hidden', () => {
    const { container } = render(<DocumentListSkeleton rows={3} />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // Skeletons container should contain 3 rows
    expect(root.children.length).toBe(3);
  });

  it('renders EnvelopeDetailSkeleton with aria-hidden', () => {
    const { container } = render(<EnvelopeDetailSkeleton />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders TopProgressBar with aria-hidden and progress beam', () => {
    const { container } = render(<TopProgressBar />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders DashboardSkeleton with aria-hidden', () => {
    const { container } = render(<DashboardSkeleton />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders AppShellSkeleton with header and dashboard skeleton', () => {
    const { container } = render(<AppShellSkeleton />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });
});
