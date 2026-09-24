import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from './logger';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copy to the clipboard and say truthfully whether it worked.
 *
 * Both call sites used to flip the label to "Copied" unconditionally — one
 * without awaiting at all, the other awaiting inside a `void` handler, which
 * turns a denied permission into an unhandled rejection. The Clipboard API is
 * unavailable on an insecure origin and can be refused outright, and a
 * fingerprint the reader believes they copied but did not is worse than an
 * error.
 */
export function useCopyToClipboard(resetAfterMs = 2000) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      try {
        if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch (cause) {
        // Only the failure is reported. The value is a fingerprint or a signing
        // link, so it never leaves the page.
        reportError(cause, 'clipboard.write');
        setState('failed');
      }
      timer.current = setTimeout(() => setState('idle'), resetAfterMs);
    },
    [resetAfterMs],
  );

  return { state, copy };
}
