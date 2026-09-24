import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Starts every new screen at the top, or at its `#anchor` when it has one.
 *
 * The browser's own restoration is switched off: it restores before the new
 * screen's data has loaded, so it landed part-way down an empty page.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pathname is what triggers the scroll; the body has no need to read it.
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Once more after the next paint: a lazily loaded screen can grow the page
    // after the first scroll and leave the view part-way down.
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return null;
}
