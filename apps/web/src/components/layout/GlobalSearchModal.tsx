import type { EnvelopeSummary } from '@envelope/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { envelopeListQuery } from '../../features/dashboard/list-query';
import { formatDateTime } from '../../lib/format';
import { StatusBadge } from '../ui/StatusBadge';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * ⌘K search over the sender's documents.
 *
 * Built on a native <dialog> rather than a positioned div: that is what keeps
 * focus inside, makes the page behind inert and closes on Escape from anywhere
 * in the panel. Written as a div, Escape only worked while the caret sat in the
 * input, so tabbing to a result trapped the reader in a modal they could not
 * dismiss.
 *
 * The results are a listbox driven by `aria-activedescendant`, so the ↑/↓
 * highlight is announced instead of being a purely visual effect.
 */
export function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listId = useId();
  const labelId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  // The All tab's own cache entry: whatever the dashboard has loaded is
  // searched, and opening search first warms the tab instead of clashing with it.
  const { data, isPending, hasNextPage } = useInfiniteQuery({
    ...envelopeListQuery('all'),
    enabled: isOpen,
  });

  const envelopes = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return envelopes.slice(0, 8);
    return envelopes
      .filter(
        (env) =>
          env.title.toLowerCase().includes(q) ||
          env.originalFilename.toLowerCase().includes(q) ||
          env.status.toLowerCase().includes(q) ||
          env.progress?.waitingOn.some((w) => w.toLowerCase().includes(q)),
      )
      .slice(0, 10);
  }, [envelopes, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      setQuery('');
      setSelectedIndex(0);
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function selectItem(item: EnvelopeSummary) {
    void navigate(`/dashboard/envelopes/${item.id}`);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[selectedIndex];
      if (item) selectItem(item);
    }
  }

  const status = isPending
    ? 'Searching your documents…'
    : filtered.length === 0
      ? 'No documents found'
      : `${filtered.length} ${filtered.length === 1 ? 'document' : 'documents'}`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby={labelId}
      className="mx-auto mt-16 w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs sm:mt-24 animate-zoom-in"
    >
      {isOpen && (
        <>
          <h2 id={labelId} className="sr-only">
            Search documents
          </h2>

          <div className="relative flex items-center border-b border-slate-100 px-4">
            <svg
              className="h-5 w-5 shrink-0 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search documents by title, file or signer"
              aria-expanded={filtered.length > 0}
              aria-controls={listId}
              aria-activedescendant={filtered.length > 0 ? optionId(selectedIndex) : undefined}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search documents by title, file, or signer…"
              className="h-13 w-full border-0 bg-transparent pl-3 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-0"
            />
            <kbd className="hidden items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500 sm:inline-flex">
              ESC
            </kbd>
          </div>

          {/* Announces the result count as the reader types, which the visual
          list alone never did. */}
          <p className="sr-only" role="status">
            {status}
          </p>

          <div className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-500">
                {isPending
                  ? 'Searching your documents…'
                  : query.trim()
                    ? hasNextPage
                      ? `None of your most recent documents match “${query.trim()}”.`
                      : `No documents match “${query.trim()}”.`
                    : 'No documents yet. Upload a PDF to get started.'}
              </p>
            ) : (
              <div id={listId} role="listbox" aria-label="Search results" className="space-y-1">
                {filtered.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      id={optionId(index)}
                      aria-selected={isSelected}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-brand-50/80 text-brand-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            isSelected
                              ? 'bg-brand-100 text-brand-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                            />
                          </svg>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {item.originalFilename}
                          </span>
                        </span>
                      </span>

                      <span className="ml-3 flex shrink-0 items-center gap-2">
                        <span className="hidden text-xs text-slate-400 sm:inline">
                          {formatDateTime(item.createdAt)}
                        </span>
                        <StatusBadge status={item.status} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Keyboard hints only where there is a keyboard. */}
          <div className="hidden items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400 pointer-fine:flex">
            <span className="flex items-center gap-3">
              <span>
                <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">↑</kbd>{' '}
                <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">↓</kbd> to
                navigate
              </span>
              <span>
                <kbd className="rounded border border-slate-200 bg-white px-1 font-mono">↵</kbd> to
                open
              </span>
            </span>
            <span>Quick search</span>
          </div>
        </>
      )}
    </dialog>
  );
}
