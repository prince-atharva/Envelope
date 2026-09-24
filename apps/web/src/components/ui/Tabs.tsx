import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Shown as a trailing pill. Part of the tab's accessible name. */
  count?: number;
  /** `warning` keeps the amber "needs attention" pill on and off the tab. */
  countTone?: 'default' | 'warning';
  icon?: ReactNode;
  onMouseEnter?: () => void;
  onFocus?: () => void;
}

export function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function panelElementId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

const VARIANTS = {
  pill: {
    list: 'flex gap-1 overflow-x-auto scrollbar-none',
    tab: 'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    selected: 'bg-brand-700 text-white',
    idle: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    count: { on: 'bg-white/20 text-white', off: 'bg-slate-200/80 text-slate-700' },
  },
  underline: {
    list: 'flex gap-4 overflow-x-auto border-b border-slate-200 scrollbar-none',
    tab: 'shrink-0 border-b-2 px-1 pb-2 text-sm font-medium transition-colors -mb-px',
    selected: 'border-brand-700 text-brand-800',
    idle: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
    count: { on: 'bg-brand-50 text-brand-800', off: 'bg-slate-100 text-slate-600' },
  },
  segmented: {
    list: 'flex w-full gap-1 rounded-xl bg-slate-100 p-1',
    tab: 'flex-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition-all sm:px-3',
    selected: 'bg-brand-700 text-white shadow-xs',
    idle: 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60',
    count: { on: 'bg-white/20 text-white', off: 'bg-slate-200/90 text-slate-700' },
  },
} as const;

/**
 * Tabs that are actually tabs.
 *
 * Three places in the app looked like tabs and were plain buttons: a screen
 * reader announced them as an undifferentiated row and gave no way to know
 * which one was on. This keeps the roles, the panel association and the arrow
 * keys in one place so that cannot drift again.
 */
export function Tabs<T extends string>({
  idPrefix,
  label,
  items,
  value,
  onChange,
  variant = 'pill',
  className = '',
}: {
  /** A `useId()` from the caller; shared with the matching <TabPanel>. */
  idPrefix: string;
  /** Names the tablist, e.g. "Document views". */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: keyof typeof VARIANTS;
  className?: string;
}) {
  const style = VARIANTS[variant];
  const listRef = useRef<HTMLDivElement>(null);

  // A row wider than the screen scrolls sideways; keep the selected tab inside
  // it. The list is scrolled, not the tab: scrollIntoView would also move the
  // page to a tab row further down it.
  useEffect(() => {
    void value;
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < list.scrollLeft || end > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = start - (list.clientWidth - tab.offsetWidth) / 2;
    }
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (step === 0 && jump === null) return;
    event.preventDefault();
    const current = items.findIndex((item) => item.id === value);
    const nextIndex = jump ?? (current + step + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.id);
    document.getElementById(tabElementId(idPrefix, next.id))?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`relative ${style.list} ${className}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={panelElementId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onMouseEnter={item.onMouseEnter}
            onFocus={item.onFocus}
            className={`${style.tab} ${selected ? style.selected : style.idle} inline-flex items-center gap-1.5`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  item.countTone === 'warning'
                    ? 'bg-amber-100 text-amber-800'
                    : selected
                      ? style.count.on
                      : style.count.off
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The region a tab controls. `id` must match the tab's `id`. */
export function TabPanel({
  idPrefix,
  id,
  children,
  className = '',
  hidden,
}: {
  idPrefix: string;
  id: string;
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  return (
    <div
      role="tabpanel"
      id={panelElementId(idPrefix, id)}
      aria-labelledby={tabElementId(idPrefix, id)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the ARIA tabs pattern wants the panel focusable, so Tab from the tablist reaches it even when it holds nothing focusable.
      tabIndex={0}
      hidden={hidden}
      className={`${hidden ? 'hidden' : 'animate-fade-in'} ${className}`}
    >
      {children}
    </div>
  );
}
