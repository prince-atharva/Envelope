import { useCopyToClipboard } from '../../lib/use-copy';

export function ExampleBlock({ title, text }: { title: string; text: string }) {
  const { state, copy } = useCopyToClipboard();
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-1">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        <button
          type="button"
          onClick={() => void copy(text)}
          aria-label={`Copy ${title}`}
          className="min-h-11 shrink-0 rounded px-2 text-xs font-semibold text-emerald-300 hover:text-white focus-visible:outline-emerald-300"
        >
          {state === 'copied' ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll long code examples.
        tabIndex={0}
        aria-label={title}
        className="max-h-[32rem] overflow-auto p-4 text-xs leading-6 text-slate-100 focus-visible:outline-emerald-300"
      >
        <pre>
          <code>{text}</code>
        </pre>
      </section>
      <p
        role="status"
        className={state === 'failed' ? 'px-4 pb-3 text-xs text-amber-300' : 'sr-only'}
      >
        {state === 'copied'
          ? `${title} copied.`
          : state === 'failed'
            ? 'Could not copy. Select the example and copy it manually.'
            : ''}
      </p>
    </div>
  );
}
