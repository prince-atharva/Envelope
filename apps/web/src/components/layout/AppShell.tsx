import { BRAND, hasAtLeast } from '@envelope/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { Logo } from '../brand/Logo';
import { IconButton } from '../ui/Button';
import { CloseIcon, MenuIcon, SearchIcon } from '../ui/icons';
import { AppFooter } from './AppFooter';
import { GlobalSearchModal } from './GlobalSearchModal';
import { navItemClass } from './navStyles';
import { SidebarAccount } from './SidebarAccount';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

const LINKS = [
  { to: '/dashboard', label: 'Documents', path: 'M9 12h6m-6 4h6M7 3h7l5 5v13H5V3h2z' },
  {
    to: '/templates',
    label: 'Templates',
    path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  },
  { to: '/bulk-batches', label: 'Bulk batches', path: 'M7 7h14v14H7zM3 17V3h14M10 12h8m-8 4h5' },
  {
    to: '/verify',
    label: 'Verify',
    path: 'M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3zM8 12l3 3 5-6',
  },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      await navigate('/login', { replace: true });
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(false);
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    if (menuOpen && !drawer.open) drawer.showModal();
    else if (!menuOpen && drawer.open) drawer.close();
  }, [menuOpen]);

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const closeAtDesktop = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener('change', closeAtDesktop);
    return () => wide.removeEventListener('change', closeAtDesktop);
  }, []);

  function prefetchVerify() {
    void import('../../features/verify/VerifyPage');
  }

  function closeNavigation() {
    setMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  const onSettings = location.pathname.startsWith('/settings');

  const navigation = (label: string) => (
    <nav aria-label={label} className="shrink-0 space-y-1">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => navItemClass(isActive)}
          onClick={closeNavigation}
          onMouseEnter={link.to === '/verify' ? prefetchVerify : undefined}
          onFocus={link.to === '/verify' ? prefetchVerify : undefined}
        >
          <NavIcon path={link.path} />
          <span>{link.label}</span>
        </NavLink>
      ))}
      {user && hasAtLeast(user.role, 'ADMIN') && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <Link
            to="/settings/integrations"
            aria-current={onSettings ? 'page' : undefined}
            className={navItemClass(onSettings)}
            onClick={closeNavigation}
          >
            <NavIcon path="M12 8a4 4 0 100 8 4 4 0 000-8zM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3z" />
            <span>Settings</span>
          </Link>
        </div>
      )}
    </nav>
  );

  const account = (
    <SidebarAccount
      user={user}
      signingOut={signingOut}
      onSignOut={signOut}
      onNavigate={closeNavigation}
      isAccountActive={location.pathname === '/account'}
    />
  );

  function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-800 focus:p-3 focus:text-white"
      >
        Skip to content
      </a>
      <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex">
        <Link
          to="/dashboard"
          onClick={closeNavigation}
          className="flex h-16 shrink-0 items-center border-b border-slate-200 px-5"
          aria-label={`${BRAND.fullName}: documents`}
        >
          <Logo />
        </Link>
        <div className="px-3 pt-4">{navigation('Main')}</div>
        {account}
      </aside>
      <dialog
        ref={drawerRef}
        aria-label="Workspace navigation"
        onKeyDown={trapFocus}
        onClose={() => {
          setMenuOpen(false);
          menuRef.current?.focus();
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[calc(100vw-3rem)] border-r border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-950/45"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 pl-5 pr-3">
            <Logo />
            <IconButton label="Close navigation" onClick={() => setMenuOpen(false)}>
              <CloseIcon className="h-5 w-5" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-3 pt-4">{navigation('Main, compact')}</div>
          {account}
        </div>
      </dialog>
      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-4 sm:px-6 lg:px-8">
            <IconButton
              ref={menuRef}
              label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="border border-slate-200 lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </IconButton>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="ml-auto flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 sm:w-full sm:max-w-sm sm:justify-start lg:ml-0"
              aria-label={`Open quick search (${SEARCH_SHORTCUT})`}
            >
              <SearchIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Quick search…</span>
              <kbd className="ml-auto hidden rounded border border-slate-200 px-1.5 text-xs sm:inline">
                {SEARCH_SHORTCUT}
              </kbd>
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8"
          tabIndex={-1}
        >
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
