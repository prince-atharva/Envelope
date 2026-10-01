import type { UserProfile } from '@envelope/shared';
import { Link } from 'react-router';
import { SignOutIcon, UserIcon } from '../ui/icons';
import { Spinner } from '../ui/Spinner';
import { navItemClass } from './navStyles';

interface SidebarAccountProps {
  user: UserProfile | null;
  signingOut: boolean;
  onSignOut: () => void | Promise<void>;
  onNavigate: () => void;
  isAccountActive: boolean;
}

/** Who is signed in, their workspace, and the two account actions, at the foot of the sidebar. */
export function SidebarAccount({
  user,
  signingOut,
  onSignOut,
  onNavigate,
  isAccountActive,
}: SidebarAccountProps) {
  const initials = user
    ? user.fullName
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '';

  return (
    <div className="mt-auto shrink-0 space-y-1 border-t border-slate-200 p-3">
      <div className="flex items-center gap-3 px-3 py-2" title={user?.tenant.name}>
        {user ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {initials}
          </span>
        ) : (
          <span
            className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-200"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {user?.fullName ?? 'Loading…'}
          </span>
          <span className="block truncate text-xs text-slate-600">{user?.tenant.name}</span>
        </span>
      </div>
      <Link
        to="/account"
        onClick={onNavigate}
        aria-current={isAccountActive ? 'page' : undefined}
        className={navItemClass(isAccountActive)}
      >
        <UserIcon className="h-5 w-5" strokeWidth={1.6} />
        <span>Account</span>
      </Link>
      <button
        type="button"
        onClick={() => void onSignOut()}
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        className={`${navItemClass()} hover:!bg-rose-50 hover:!text-rose-700`}
      >
        {signingOut ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <SignOutIcon className="h-5 w-5" strokeWidth={1.6} />
        )}
        <span>Sign out</span>
      </button>
    </div>
  );
}
