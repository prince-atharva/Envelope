import { hasAtLeast } from '@envelope/shared';
import { NavLink } from 'react-router';
import { useAuth } from '../../lib/auth';

function tabClass({ isActive }: { isActive: boolean }): string {
  return `inline-flex min-h-11 shrink-0 items-center border-b-2 px-2 text-sm font-medium transition-colors -mb-px ${
    isActive
      ? 'border-brand-700 text-brand-800'
      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-800'
  }`;
}

/** Role-aware navigation shared by every Settings screen (docs/19 step 2). */
export function SettingsNav() {
  const { user } = useAuth();
  return (
    <nav
      aria-label="Settings"
      className="flex gap-4 overflow-x-auto border-b border-slate-200 scrollbar-none"
    >
      <NavLink to="/settings/integrations" className={tabClass}>
        Integrations
      </NavLink>
      {user && hasAtLeast(user.role, 'ADMIN') && (
        <NavLink to="/settings/branding" className={tabClass}>
          Branding
        </NavLink>
      )}
      {user && hasAtLeast(user.role, 'OWNER') && (
        <NavLink to="/settings/users" className={tabClass}>
          Users
        </NavLink>
      )}
    </nav>
  );
}
