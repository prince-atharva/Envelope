import type { UserProfile } from '@envelope/shared';
import { Spinner } from '../ui/Spinner';

interface UserBarProps {
  user: UserProfile | null;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
}

/** The signed-in person and their workspace, with Sign out. */
export function UserBar({ user, onSignOut, signingOut }: UserBarProps) {
  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((part) => part[0])
        .filter(Boolean)
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  return (
    <div className="flex items-center gap-3">
      {/* Hidden on phones: at 375px the avatar pushed into the logo. */}
      <div className="hidden items-center gap-2.5 sm:flex">
        {user ? (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-tr from-brand-700 to-brand-500 text-xs font-semibold text-white shadow-2xs ring-2 ring-white"
            aria-hidden="true"
            title={`${user.fullName}, ${user.tenant.name}`}
          >
            {initials}
          </div>
        ) : (
          <div
            className="h-8 w-8 shrink-0 rounded-full bg-slate-200/80 animate-pulse ring-2 ring-white shadow-2xs"
            aria-hidden="true"
          />
        )}

        {/* Name and workspace from lg up; below that the avatar's tooltip carries them. */}
        <div className="hidden lg:flex flex-col min-w-0 text-left">
          {user ? (
            <>
              <span className="truncate text-xs font-semibold text-slate-900 leading-snug max-w-40">
                {user.fullName}
              </span>
              <span className="truncate text-xs text-slate-500 leading-snug max-w-40">
                {user.tenant.name}
              </span>
            </>
          ) : (
            <div className="space-y-1 py-0.5" aria-hidden="true">
              <div className="h-3 w-16 rounded bg-slate-200/80 animate-pulse" />
              <div className="h-2.5 w-12 rounded bg-slate-100 animate-pulse" />
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block h-5 w-px bg-slate-200/90 shrink-0" aria-hidden="true" />

      <button
        type="button"
        onClick={() => void onSignOut()}
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        className="group flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50/70 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-2xs hover:border-rose-200 hover:bg-rose-50/80 hover:text-rose-700 transition-all disabled:opacity-50"
      >
        {signingOut ? (
          <Spinner className="h-3.5 w-3.5 text-rose-600" />
        ) : (
          <svg
            className="h-3.5 w-3.5 text-slate-400 group-hover:text-rose-600 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        )}
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </button>
    </div>
  );
}
