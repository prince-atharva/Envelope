import { hasAtLeast } from '@envelope/shared';
import { NavLink } from 'react-router';
import { useAuth } from '../../lib/auth';

function tabClass({ isActive }: { isActive: boolean }): string {
  return `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-brand-50 text-brand-800'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;
}

/** Role-aware navigation shared by every Settings screen (docs/19 step 2). */
export function SettingsNav() {
  const { user } = useAuth();
  return (
    <nav aria-label="Settings" className="flex gap-1 border-b border-slate-200 pb-3">
      <NavLink to="/settings/integrations" className={tabClass}>
        Integrations
      </NavLink>
      {user && hasAtLeast(user.role, 'OWNER') && (
        <NavLink to="/settings/users" className={tabClass}>
          Users
        </NavLink>
      )}
    </nav>
  );
}
