import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { AuthLayout } from './components/layout/AuthLayout';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { BulkBatchesPage } from './features/bulk/BulkBatchesPage';
import { BulkBatchPage } from './features/bulk/BulkBatchPage';
import { BulkSendPage } from './features/bulk/BulkSendPage';
import { AuthProvider } from './lib/auth';
import { AccountPage } from './pages/AccountPage';
import { DashboardPage } from './pages/DashboardPage';
import { EnvelopeDetailPage } from './pages/EnvelopeDetailPage';
import { LoginPage } from './pages/LoginPage';
import { NewEnvelopePage } from './pages/NewEnvelopePage';
import { PreparePage } from './pages/PreparePage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsBrandingPage } from './pages/SettingsBrandingPage';
import { SettingsIntegrationsPage } from './pages/SettingsIntegrationsPage';
import { SettingsUsersPage } from './pages/SettingsUsersPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { GuestOnly, RequireAuth, RequireRole } from './routes/guards';

/**
 * Everything a sender uses: their account, the dashboard and the document
 * pages. Loaded as its own chunk, so a signer's phone never downloads it, and
 * the only place the session is restored from the refresh cookie.
 */
export default function SenderApp() {
  return (
    <AuthProvider>
      <Routes>
        {/* Guest-only: login and register */}
        <Route element={<GuestOnly />}>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
        </Route>

        {/* Signed-in: dashboard and document pages */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/account" element={<AccountPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/templates/:id/bulk" element={<BulkSendPage />} />
            <Route path="/bulk-batches" element={<BulkBatchesPage />} />
            <Route path="/bulk-batches/:id" element={<BulkBatchPage />} />
            <Route path="/dashboard/new" element={<NewEnvelopePage />} />
            <Route path="/dashboard/envelopes/:id" element={<EnvelopeDetailPage />} />
            <Route path="/dashboard/envelopes/:id/prepare" element={<PreparePage />} />
            <Route path="/dashboard/envelopes/:id/review" element={<ReviewPage />} />
            <Route element={<RequireRole minimum="ADMIN" />}>
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings/integrations" element={<SettingsIntegrationsPage />} />
              <Route path="/settings/branding" element={<SettingsBrandingPage />} />
            </Route>
            <Route element={<RequireRole minimum="OWNER" />}>
              <Route path="/settings/users" element={<SettingsUsersPage />} />
            </Route>
          </Route>
        </Route>

        {/* Catch-all: go to dashboard (RequireAuth will redirect to login if needed) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
