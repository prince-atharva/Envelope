import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs';

describe('Tabs', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const items = [
    { id: 'tab1', label: 'First Tab', count: 3 },
    { id: 'tab2', label: 'Second Tab', count: 0 },
    { id: 'tab3', label: 'Third Tab' },
  ] as const;

  it('renders tablist and tabs with correct accessibility attributes', () => {
    render(
      <Tabs idPrefix="test" label="Test Views" items={items} value="tab1" onChange={vi.fn()} />,
    );

    const tablist = screen.getByRole('tablist', { name: 'Test Views' });
    expect(tablist).toBeTruthy();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);

    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
  });

  it('triggers onChange when a tab is clicked', () => {
    const onChange = vi.fn();
    render(
      <Tabs idPrefix="test" label="Test Views" items={items} value="tab1" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Second Tab/ }));
    expect(onChange).toHaveBeenCalledWith('tab2');
  });

  it('triggers onMouseEnter and onFocus prefetch handlers', () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();

    const itemsWithHandlers = [
      { id: 'tab1', label: 'First Tab', onMouseEnter, onFocus },
      { id: 'tab2', label: 'Second Tab' },
    ] as const;

    render(
      <Tabs
        idPrefix="test"
        label="Test Views"
        items={itemsWithHandlers}
        value="tab2"
        onChange={vi.fn()}
      />,
    );

    const tab1 = screen.getByRole('tab', { name: /First Tab/ });
    fireEvent.mouseEnter(tab1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);

    fireEvent.focus(tab1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('renders TabPanel respecting the hidden attribute', () => {
    render(
      <>
        <TabPanel idPrefix="test" id="tab1" hidden={false}>
          <div>Active Panel Content</div>
        </TabPanel>
        <TabPanel idPrefix="test" id="tab2" hidden={true}>
          <div>Hidden Panel Content</div>
        </TabPanel>
      </>,
    );

    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels.length).toBe(2);

    const activeEl = screen.getByText('Active Panel Content').parentElement as HTMLElement;
    expect(activeEl.hasAttribute('hidden')).toBe(false);
    expect(activeEl.className).toContain('animate-fade-in');

    const hiddenEl = screen.getByText('Hidden Panel Content').parentElement as HTMLElement;
    expect(hiddenEl.hasAttribute('hidden')).toBe(true);
    expect(hiddenEl.className).toContain('hidden');
  });
});
