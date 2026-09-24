import { Outlet } from 'react-router';
import { Logo } from '../brand/Logo';
import { AppFooter } from './AppFooter';

/** Centered card for sign-in and sign-up with global footer. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-brand-50/60 to-slate-50">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8">
          <Logo size="lg" />
        </div>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
          <Outlet />
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
