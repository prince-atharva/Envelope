import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getLastRequestId } from '../lib/api';
import { reportError } from '../lib/logger';
import { Button } from './ui/Button';

interface State {
  error: Error | null;
}

/** Catches rendering errors, reports them to the server log and shows a way out. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (info.componentStack)
      error.stack = `${error.stack ?? ''}\nComponent stack:${info.componentStack}`;
    reportError(error, 'error-boundary');
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <ErrorScreen reference={getLastRequestId()} />;
  }
}

export function ErrorScreen({ reference }: { reference?: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-slate-600">
        The problem has been reported. Reloading the page usually helps.
      </p>
      {reference && <p className="font-mono text-xs text-slate-500">Reference: {reference}</p>}
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </div>
  );
}
