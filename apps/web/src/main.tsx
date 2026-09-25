import './polyfills';
import '@fontsource-variable/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollToTop } from './components/layout/ScrollToTop';
import { TopProgressBar } from './components/ui/Skeletons';
import { installGlobalErrorHandlers } from './lib/logger';
import './styles/index.css';

installGlobalErrorHandlers();

// Two separate apps behind one router. A signer arrives from an email, often on
// a phone over a poor connection, and gets only the signing portal: no sender
// pages, and no attempt to restore a sender session (docs/09, performance budget).
const SigningPage = lazy(() => import('./features/signing/SigningPage'));
// Verify is public too: anyone holding a copy can check it (docs/15 step 7).
const VerifyPage = lazy(() => import('./features/verify/VerifyPage'));
// A tenant invitation and a completion download link are both public, token-only pages.
const AcceptInvitePage = lazy(() => import('./features/invite/AcceptInvitePage'));
const DownloadPage = lazy(() => import('./features/download/DownloadPage'));
const SenderApp = lazy(() => import('./SenderApp'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
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
        <BrowserRouter>
          <ScrollToTop />
          {/* Neutral on purpose: this also covers the signer's and Verify's
              chunks, and a signer must never see the sender app's frame. */}
          <Suspense fallback={<TopProgressBar />}>
            <Routes>
              <Route path="/sign/:token" element={<SigningPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
              <Route path="/download/:token" element={<DownloadPage />} />
              <Route path="*" element={<SenderApp />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
