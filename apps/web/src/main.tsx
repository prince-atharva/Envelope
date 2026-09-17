import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/layout/AppShell';
import { AuthLayout } from './components/layout/AuthLayout';
import { AuthProvider } from './lib/auth';
import { installGlobalErrorHandlers } from './lib/logger';
import { DashboardPage } from './pages/DashboardPage';
import { EnvelopeDetailPage } from './pages/EnvelopeDetailPage';
import { LoginPage } from './pages/LoginPage';
import { NewEnvelopePage } from './pages/NewEnvelopePage';
import { PreparePage } from './pages/PreparePage';
import { RegisterPage } from './pages/RegisterPage';
import { ReviewPage } from './pages/ReviewPage';
import { GuestOnly, RequireAuth } from './routes/guards';
import './styles/index.css';

installGlobalErrorHandlers();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthProvider>
          <BrowserRouter>
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
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
