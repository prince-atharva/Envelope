import { hasAtLeast, type UserRole } from '@envelope/shared';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AppShellSkeleton, TopProgressBar } from '../components/ui/Skeletons';
import { useAuth } from '../lib/auth';

export interface RedirectState {
  from?: string;
}

/**
 * Only for signed-in users; everyone else goes to /login and comes back afterwards.
 *
 * The page is held back until the session is restored: its first request would
 * otherwise go out without an access token and fail as signed out.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <AppShellSkeleton />;
  if (status === 'anonymous') {
    const state: RedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/**
 * Only for a user whose role is at least `minimum` (docs/17 step 5). Nested
 * inside `RequireAuth`, so `status` is always `authenticated` here; a
 * MEMBER visiting Settings goes back to the dashboard rather than seeing an
 * empty or broken screen.
 */
export function RequireRole({ minimum }: { minimum: UserRole }) {
  const { user } = useAuth();
  if (!user || !hasAtLeast(user.role, minimum)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

/** Sign-in and sign-up pages: signed-in users go straight to the dashboard. */
export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <TopProgressBar />;
  if (status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    // Only same-site paths: "//host" would leave the app.
    const safe = from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
    return <Navigate to={safe} replace />;
  }
  return <Outlet />;
}
