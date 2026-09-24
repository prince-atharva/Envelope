import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../brand/Logo';
import { AppFooter } from './AppFooter';

/**
 * The card public pages sit in: the signer's screens before and after the
 * document, and Verify. `wide` gives room for tables.
 *
 * `backTo` is opt-in because a signer has no account and must never be offered
 * a way into the sender app. Verify passes it: the header links there from the
 * signed-in app, and without it the only way back was the browser's Back
 * button.
 */
export function PublicFrame({
  children,
  wide = false,
  backTo,
  backLabel = 'Back to documents',
}: {
  children: ReactNode;
  wide?: boolean;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-brand-50/60 to-slate-50">
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
        <div className="mb-6 flex flex-col items-center gap-2">
          {backTo ? (
            <Link to={backTo} aria-label={backLabel}>
              <Logo />
            </Link>
          ) : (
            <Logo />
          )}
          {backTo && (
            <Link
              to={backTo}
              className="text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline"
            >
              ← {backLabel}
            </Link>
          )}
        </div>
        <div
          className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-8`}
        >
          {children}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
