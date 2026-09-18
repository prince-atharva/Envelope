import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { AuthLayout } from './components/layout/AuthLayout';
import { AuthProvider } from './lib/auth';
import { DashboardPage } from './pages/DashboardPage';
import { EnvelopeDetailPage } from './pages/EnvelopeDetailPage';
import { LoginPage } from './pages/LoginPage';
import { NewEnvelopePage } from './pages/NewEnvelopePage';
import { PreparePage } from './pages/PreparePage';
import { RegisterPage } from './pages/RegisterPage';
import { ReviewPage } from './pages/ReviewPage';
import { GuestOnly, RequireAuth } from './routes/guards';

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
          </Route>
        </Route>

        {/* Signed-in: dashboard and document pages */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/new" element={<NewEnvelopePage />} />
            <Route path="/dashboard/envelopes/:id" element={<EnvelopeDetailPage />} />
            <Route path="/dashboard/envelopes/:id/prepare" element={<PreparePage />} />
            <Route path="/dashboard/envelopes/:id/review" element={<ReviewPage />} />
          </Route>
        </Route>

        {/* Catch-all: go to dashboard (RequireAuth will redirect to login if needed) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
