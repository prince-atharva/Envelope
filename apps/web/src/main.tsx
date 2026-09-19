import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FullPageSpinner } from './components/ui/Spinner';
import { installGlobalErrorHandlers } from './lib/logger';
import './styles/index.css';

installGlobalErrorHandlers();

// Two separate apps behind one router. A signer arrives from an email, often on
// a phone over a poor connection, and gets only the signing portal: no sender
// pages, and no attempt to restore a sender session (docs/09, performance budget).
const SigningPage = lazy(() => import('./features/signing/SigningPage'));
// Verify is public too: anyone holding a copy can check it (docs/15 step 7).
const VerifyPage = lazy(() => import('./features/verify/VerifyPage'));
const SenderApp = lazy(() => import('./SenderApp'));

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
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/sign/:token" element={<SigningPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="*" element={<SenderApp />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
