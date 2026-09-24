import { BRAND } from '@envelope/shared';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { Logo } from '../brand/Logo';
import { AppFooter } from './AppFooter';
import { GlobalSearchModal } from './GlobalSearchModal';
import { UserBar } from './UserBar';

function navClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
    isActive
      ? 'bg-brand-50 text-brand-800 font-semibold'
      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
  }`;
}

/** Returns to the top when the link clicked is the screen already open. */
function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
}

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

/** Signed-in layout: header with navigation, quick search and the account; footer. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      await navigate('/login', { replace: true });
    }
  }

  // Verify is its own chunk; start fetching it as soon as the pointer heads there.
  const prefetchVerify = () => {
    void import('../../features/verify/VerifyPage');
  };

  // ⌘K / Ctrl+K opens and closes quick search from anywhere in the app.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50/50">
      <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Nothing here may wrap: at tablet width the logo, the search label and
              the name used to break onto two lines and push Sign out off screen. */}
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <Link to="/dashboard" onClick={scrollToTop} aria-label={`${BRAND.fullName}: documents`}>
              <Logo />
            </Link>

            <nav
              aria-label="Main"
              className="hidden shrink-0 items-center gap-1 whitespace-nowrap sm:flex"
            >
              <NavLink to="/dashboard" end className={navClass} onClick={scrollToTop}>
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>Documents</span>
              </NavLink>

              <NavLink
                to="/verify"
                className={navClass}
                onMouseEnter={prefetchVerify}
                onFocus={prefetchVerify}
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span>Verify</span>
              </NavLink>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap sm:gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-slate-200/90 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-100 transition-colors"
              aria-label={`Open quick search (${SEARCH_SHORTCUT})`}
            >
              <svg
                className="h-3.5 w-3.5 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <span className="hidden lg:inline">Quick search…</span>
              <kbd className="hidden lg:inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-400">
                {SEARCH_SHORTCUT}
              </kbd>
            </button>

            <UserBar user={user} onSignOut={signOut} signingOut={signingOut} />
          </div>
        </div>

        {/* Phones: the same links on a strip of their own. */}
        <nav
          aria-label="Main, compact"
          className="flex gap-1 border-t border-slate-100 px-4 py-2 sm:hidden"
        >
          <NavLink to="/dashboard" end className={navClass} onClick={scrollToTop}>
            Documents
          </NavLink>
          <NavLink
            to="/verify"
            className={navClass}
            onMouseEnter={prefetchVerify}
            onFocus={prefetchVerify}
          >
            Verify
          </NavLink>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6 flex flex-col min-h-0">
        <Outlet />
      </main>

      <AppFooter />
    </div>
  );
}
