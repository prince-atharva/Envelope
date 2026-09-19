import { BRAND } from '@envelope/shared';
import type { ReactNode } from 'react';
import { Logo } from '../brand/Logo';

/**
 * The card public pages sit in: the signer's screens before and after the
 * document, and Verify. `wide` gives room for tables.
 */
export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
        <div className="mb-6">
          <Logo />
        </div>
        <div
          className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8`}
        >
          {children}
        </div>
        <p className="mt-6 max-w-md text-center text-xs text-slate-500">{BRAND.tagline}</p>
      </main>
    </div>
  );
}
