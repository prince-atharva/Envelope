import { PasswordSection } from '../features/account/PasswordSection';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../lib/use-document-title';

/** `/account` (docs/19 slice 2): the signed-in person's own sign-in settings, for every role. */
export function AccountPage() {
  useDocumentTitle('Account');
  const { user } = useAuth();

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Account</h1>
        <p className="mt-1 text-sm text-slate-500">
          How you sign in{user ? ` as ${user.email}` : ''}.
        </p>
      </div>
      <PasswordSection />
    </div>
  );
}
