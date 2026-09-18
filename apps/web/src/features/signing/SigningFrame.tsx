import { BRAND } from '@envelope/shared';
import type { ReactNode } from 'react';
import { Logo } from '../../components/brand/Logo';

/** The card every signer screen before and after the document sits in. */
export function SigningFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
        <div className="mb-6">
          <Logo />
        </div>
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          {children}
        </div>
        <p className="mt-6 max-w-md text-center text-xs text-slate-500">{BRAND.tagline}</p>
      </main>
    </div>
  );
}
