import { BRAND } from '@digitalsign/shared';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { Logo } from '../brand/Logo';
import { Button } from '../ui/Button';

function navClass({ isActive }: { isActive: boolean }): string {
  return `rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-brand-50 text-brand-800'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;
}

/** Signed-in layout: header with navigation and the account menu. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      await navigate('/login', { replace: true });
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/dashboard" aria-label={`${BRAND.fullName}: documents`}>
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            <NavLink to="/dashboard" end className={navClass}>
              Documents
            </NavLink>
            <NavLink to="/dashboard/new" className={navClass}>
              Upload
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <div className="text-sm font-medium text-slate-900">{user?.fullName}</div>
              <div className="text-xs text-slate-500">{user?.tenant.name}</div>
            </div>
            <Button variant="secondary" onClick={() => void signOut()} loading={signingOut}>
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 border-t border-slate-100 px-4 py-2 sm:hidden">
          <NavLink to="/dashboard" end className={navClass}>
            Documents
          </NavLink>
          <NavLink to="/dashboard/new" className={navClass}>
            Upload
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-3 sm:px-6 sm:py-4 flex flex-col min-h-0">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        {BRAND.fullName}
      </footer>
    </div>
  );
}
