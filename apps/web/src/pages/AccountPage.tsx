import { PageHeader } from '../components/ui/PageHeader';
import { PasswordSection } from '../features/account/PasswordSection';
import { TwoFactorSection } from '../features/account/TwoFactorSection';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../lib/use-document-title';

/** `/account` (docs/19 slice 2): the signed-in person's own sign-in settings, for every role. */
export function AccountPage() {
  useDocumentTitle('Account');
  const { user } = useAuth();

  return (
    <div className="page-stack max-w-4xl">
      <PageHeader
        title="Account"
        description={`How you sign in${user ? ` as ${user.email}` : ''}.`}
      />
      <PasswordSection />
      <TwoFactorSection />
    </div>
  );
}
