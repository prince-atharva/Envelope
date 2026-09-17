import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/ui/Spinner';
import { useAuth } from '../lib/auth';

export interface RedirectState {
  from?: string;
}

/** Only for signed-in users; everyone else goes to /login and comes back afterwards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    const state: RedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Sign-in and sign-up pages: signed-in users go straight to the dashboard. */
export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    // Only same-site paths: "//host" would leave the app.
    const safe = from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
    return <Navigate to={safe} replace />;
  }
  return <Outlet />;
}
