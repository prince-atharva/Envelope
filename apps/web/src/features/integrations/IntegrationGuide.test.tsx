import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExampleBlock, IntegrationGuide } from './IntegrationGuide';

vi.mock('../../lib/logger', () => ({ reportError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.restoreAllMocks();
});

describe('integration guide', () => {
  it('navigates, searches methods and recovers from no results', () => {
    const manage = vi.fn();
    render(<IntegrationGuide onManage={manage} />);
    fireEvent.click(screen.getByRole('tab', { name: 'API reference' }));
    const search = screen.getByRole('searchbox', { name: 'Search API operations' });
    fireEvent.change(search, { target: { value: 'DELETE' } });
    expect(screen.getByText('1 of 12 operations')).toBeTruthy();
    expect(screen.getByText('Remove a recipient')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nonexistent' } });
    expect(screen.getByText(/No matching operations/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('12 of 12 operations')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage connections' }));
    expect(manage).toHaveBeenCalledOnce();
  });
  it('explains both HealthProHub entry modes and links to origin management', () => {
    const manage = vi.fn();
    render(<IntegrationGuide onManage={manage} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Embedded editor' }));
    expect(screen.getByLabelText('Existing draft session body').textContent).toContain(
      '"existing"',
    );
    expect(screen.getByLabelText('Upload session body').textContent).toContain('"upload"');
    expect(screen.getByText(/30 minutes after session creation/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage API keys and origins' }));
    expect(manage).toHaveBeenCalledOnce();
  });
  it('changes webhook payloads and explains the unsupported event', () => {
    render(<IntegrationGuide onManage={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Webhook guide' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Webhook event' }), {
      target: { value: 'recipient.consented' },
    });
    expect(screen.getByLabelText('Webhook payload').textContent).toContain('consentGivenAt');
    expect(screen.getByText(/envelope.delivered is reserved/)).toBeTruthy();
  });
  it('announces successful copying of the actual displayed example', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ExampleBlock title="Example" text="placeholder-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Example' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Example copied.'));
    expect(writeText).toHaveBeenCalledWith('placeholder-only');
    vi.unstubAllGlobals();
  });
  it('provides a manual fallback when copying fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    render(<ExampleBlock title="Example" text="placeholder-only" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Example' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not copy'));
    vi.unstubAllGlobals();
  });
});
