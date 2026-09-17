import { BRAND } from '@envelope/shared';
import { Outlet } from 'react-router';
import { Logo } from '../brand/Logo';

/** Centered card for sign-in and sign-up. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8">
          <Logo size="lg" />
        </div>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <Outlet />
        </div>
        <p className="mt-6 max-w-md text-center text-xs text-slate-500">{BRAND.tagline}</p>
      </main>
    </div>
  );
}
