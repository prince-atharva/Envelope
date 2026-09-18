import { CLIENT_LOG_MAX_BYTES, type ClientLog } from '@envelope/shared';
import { getLastRequestId } from './api';

const MAX_REPORTS_PER_PAGE_LOAD = 20;
const DUPLICATE_WINDOW_MS = 10_000;

const recent = new Map<string, number>();
let sent = 0;

function truncate(value: string | undefined, max: number): string | undefined {
  return value === undefined || value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** A signing link's token, wherever it appears: page URL, API path, message or stack. */
const SIGNING_PATH = /(\/sign\/)[^/?#\s"':)]+/gi;

/**
 * Masks signing tokens in any text. The token is the signer's only credential
 * (docs/10), and on the signing page it is in the page's own path, so it turns
 * up in stack traces and error messages. The server scrubs reports too; this
 * keeps the token from leaving the browser at all.
 */
export function redactSigningLinks(text: string): string {
  return text.replace(SIGNING_PATH, '$1[redacted]');
}

/**
 * Builds a report that fits the server's limits. The page URL is sent without its
 * query string or fragment, which can carry tokens, and signing tokens are
 * masked everywhere.
 */
export function buildClientLog(
  error: unknown,
  source: string,
  context: { url: string; userAgent?: string; lastRequestId?: string },
): ClientLog {
  const err = error instanceof Error ? error : new Error(String(error));
  const url = new URL(context.url);
  const report: ClientLog = {
    level: 'error',
    message: truncate(redactSigningLinks(`${err.name}: ${err.message}`), 2000) ?? 'Error',
    stack: truncate(err.stack === undefined ? undefined : redactSigningLinks(err.stack), 6000),
    url: truncate(redactSigningLinks(`${url.origin}${url.pathname}`), 2000) ?? '',
    source: truncate(source, 100) ?? 'unknown',
    lastRequestId: context.lastRequestId,
    userAgent: truncate(context.userAgent, 500),
    occurredAt: new Date().toISOString(),
  };
  // Stay under the byte limit, dropping stack detail first.
  while (
    report.stack &&
    new TextEncoder().encode(JSON.stringify(report)).length > CLIENT_LOG_MAX_BYTES
  ) {
    report.stack =
      report.stack.length > 200 ? report.stack.slice(0, report.stack.length / 2) : undefined;
  }
  return report;
}

/**
 * Sends a browser error to the API (POST /client-logs) so it shows up in the
 * server logs next to the request that led to it. Also logged to the console in
 * development. Never throws.
 */
export function reportError(error: unknown, source: string): void {
  try {
    if (import.meta.env.DEV) console.error(`[${source}]`, error);

    const report = buildClientLog(error, source, {
      url: window.location.href,
      userAgent: navigator.userAgent,
      lastRequestId: getLastRequestId(),
    });

    const key = `${report.source}|${report.message}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - DUPLICATE_WINDOW_MS) return;
    if (sent >= MAX_REPORTS_PER_PAGE_LOAD) return;
    recent.set(key, now);
    sent += 1;

    void fetch('/api/v1/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    // Error reporting must never cause a second error.
  }
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, 'window.onerror');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'unhandledrejection');
  });
}
