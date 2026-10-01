import { Outlet } from 'react-router';
import { Logo } from '../brand/Logo';
import { CheckIcon, DocumentIcon } from '../ui/icons';
import { AppFooter } from './AppFooter';

export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <main className="grid flex-1 lg:grid-cols-2">
        <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-brand-100 bg-brand-50/50 p-10 lg:flex xl:p-16">
          <Logo size="lg" />
          <div className="relative mx-auto my-12 w-full max-w-md">
            <div
              className="relative mx-auto mb-12 w-64 rounded-xl border border-slate-200 bg-white p-7 shadow-lg shadow-brand-900/5"
              aria-hidden="true"
            >
              <div className="mb-6 flex items-center justify-between">
                <DocumentIcon className="h-7 w-7 text-brand-700" />
                <span className="rounded-full bg-brand-50 p-2 text-brand-800">
                  <CheckIcon className="h-4 w-4" />
                </span>
              </div>
              <div className="mb-3 h-2.5 w-28 rounded bg-slate-200" />
              <div className="space-y-2">
                <div className="h-1.5 rounded bg-slate-100" />
                <div className="h-1.5 rounded bg-slate-100" />
                <div className="h-1.5 w-4/5 rounded bg-slate-100" />
              </div>
              <div className="mt-8 flex h-14 items-center justify-center rounded-lg border border-dashed border-brand-300 bg-brand-50/40 text-sm font-medium text-brand-800">
                Your signature
              </div>
              <div className="absolute -right-8 -bottom-5 flex items-center gap-2 rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm font-medium text-brand-800 shadow-sm">
                <CheckIcon className="h-4 w-4" /> Signed and sealed
              </div>
            </div>
            <p className="text-4xl font-semibold leading-tight tracking-tight text-slate-900">
              From document
              <br />
              to done.
            </p>
            <p className="mt-5 max-w-sm text-base leading-7 text-slate-600">
              Prepare your documents, collect signatures, and keep a clear record. All in one
              workspace.
            </p>
            <div className="mt-8 flex gap-3 text-xs font-semibold text-brand-800">
              <span>Upload</span>
              <span aria-hidden="true">/</span>
              <span>Prepare</span>
              <span aria-hidden="true">/</span>
              <span>Send</span>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col items-center justify-center px-5 py-10 sm:px-10">
          <div className="mb-10 lg:hidden">
            <Logo size="lg" />
          </div>
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
