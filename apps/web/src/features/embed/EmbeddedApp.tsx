import {
  EMBED_PROTOCOL_VERSION,
  type EmbedSessionResponse,
  embedParentMessageSchema,
} from '@envelope/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router';
import { Button } from '../../components/ui/Button';
import { DialogShell } from '../../components/ui/DialogShell';
import { NewEnvelopePage } from '../../pages/NewEnvelopePage';
import { PreparePage } from '../../pages/PreparePage';
import { ReviewPage } from '../../pages/ReviewPage';
import { type EditorRuntime, EditorRuntimeContext } from './editor-runtime';
import { createEmbedApi } from './embed-api';

type Metadata = Omit<EmbedSessionResponse, 'accessToken'>;
function bootstrap(): { sessionId: string; parentOrigin: string } {
  const raw = JSON.parse(document.getElementById('embed-bootstrap')?.textContent ?? '{}') as {
    sessionId?: string;
    parentOrigin?: string;
  };
  if (!raw.sessionId || !raw.parentOrigin)
    throw new Error('Embedded editor must use its authorized frame URL');
  return { sessionId: raw.sessionId, parentOrigin: raw.parentOrigin };
}
export default function EmbeddedApp() {
  const [initial] = useState(bootstrap);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false, gcTime: 0 },
        },
      }),
  );
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [client, setClient] = useState<ReturnType<typeof createEmbedApi> | null>(null);
  const [ended, setEnded] = useState(false);
  const [expired, setExpired] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [failure, setFailure] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const closeHandler = useRef<(() => Promise<boolean | 'busy'>) | null>(null);
  const exchangeStarted = useRef(false);
  const active = useRef(false);
  const closed = useRef(false);
  const closing = useRef(false);
  const clientRef = useRef(client);
  clientRef.current = client;
  const emit = useCallback(
    (event: Record<string, unknown>) => {
      if (active.current)
        window.parent.postMessage(
          { version: EMBED_PROTOCOL_VERSION, sessionId: initial.sessionId, ...event },
          initial.parentOrigin,
        );
    },
    [initial],
  );
  const close = useCallback(
    async (discard = false) => {
      if (closed.current || closing.current) return;
      closing.current = true;
      if (!discard && expired) {
        closing.current = false;
        setDiscarding(true);
        return;
      }
      const readiness = closeHandler.current ? await closeHandler.current() : true;
      if (readiness === 'busy') {
        closing.current = false;
        setFailure('Please wait for the upload or send to finish before closing.');
        return;
      }
      if (!discard && !readiness) {
        closing.current = false;
        setFailure(
          'Your latest changes could not be saved. Resolve the save error before closing.',
        );
        setDiscarding(true);
        return;
      }
      try {
        if (!expired) await clientRef.current?.close();
      } catch {
        closing.current = false;
        setFailure('Could not close the editor. Please try again.');
        return;
      }
      clientRef.current?.destroy();
      queryClient.clear();
      setDiscarding(false);
      setEnded(true);
      emit({ type: 'close' });
      closed.current = true;
    },
    [emit, expired, queryClient],
  );
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    async function receive(event: MessageEvent) {
      if (closed.current || closing.current) return;
      if (event.origin !== initial.parentOrigin || event.source !== window.parent) return;
      const parsed = embedParentMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.sessionId !== initial.sessionId) return;
      if (parsed.data.type === 'request.close') {
        void closeRef.current();
        return;
      }
      if (exchangeStarted.current) return;
      exchangeStarted.current = true;
      try {
        const result = await fetch('/api/v1/embed/sessions/exchange', {
          method: 'POST',
          credentials: 'omit',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: initial.sessionId,
            launchToken: parsed.data.launchToken,
          }),
        });
        if (!result.ok)
          throw new Error('Unable to open editor. Request a new session from your application.');
        const session = (await result.json()) as EmbedSessionResponse;
        if (!active.current || closed.current || closing.current) {
          const abandoned = createEmbedApi(session.accessToken, () => {});
          try {
            await abandoned.close();
          } finally {
            abandoned.destroy();
          }
          return;
        }
        const transport = createEmbedApi(session.accessToken, () => {
          setExpired(true);
          emit({ type: 'session.expired' });
        });
        const { accessToken: _secret, ...safe } = session;
        clientRef.current = transport;
        setMetadata(safe);
        setClient(transport);
      } catch {
        if (active.current) {
          setFailure('Unable to open editor. Request a new session from your application.');
          emit({ type: 'error', code: 'EMBED_SESSION_INVALID' });
        }
      }
    }
    window.addEventListener('message', receive);
    emit({ type: 'ready' });
    return () => {
      active.current = false;
      controller.abort();
      window.removeEventListener('message', receive);
      clientRef.current?.destroy();
      queryClient.clear();
    };
  }, [emit, initial, queryClient]);
  useEffect(() => {
    if (!metadata) return;
    const timer = setTimeout(
      () => {
        clientRef.current?.destroy();
        setExpired(true);
        emit({ type: 'session.expired' });
      },
      Math.max(0, Date.parse(metadata.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [metadata, emit]);
  const runtime = useMemo<EditorRuntime | null>(
    () =>
      client && metadata
        ? {
            api: client.api,
            embedded: true,
            canSend: metadata.actions.includes('send'),
            detail: () => '/sent',
            prepare: (id) => `/envelopes/${id}/prepare`,
            review: (id) => `/envelopes/${id}/review`,
            uploaded: (id) => emit({ type: 'draft.created', envelopeId: id }),
            sent: (id) => {
              setSentId(id);
              emit({ type: 'envelope.sent', envelopeId: id });
            },
            saved: (id, revision) => emit({ type: 'draft.saved', envelopeId: id, revision }),
            close: () => {
              void closeRef.current();
            },
            registerClose: (handler) => {
              closeHandler.current = handler;
              return () => {
                if (closeHandler.current === handler) closeHandler.current = null;
              };
            },
          }
        : null,
    [client, metadata, emit],
  );
  if (ended) return <p className="p-6">Editor closed. You can continue in your application.</p>;
  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-5">
      <DialogShell
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Close without saving?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button onClick={() => void close(true)}>Discard unsaved changes</Button>
          </>
        }
      >
        <p>Your unsaved changes will be lost. The last saved draft remains in Envelope.</p>
      </DialogShell>
      <header className="mb-4 flex items-center justify-between gap-3">
        <p className="font-semibold">Envelope powered by HealthProHub</p>
        <Button variant="secondary" onClick={() => void close()}>
          Close editor
        </Button>
      </header>
      {failure && (
        <p role="alert" className="mb-4 text-red-700">
          {failure}
        </p>
      )}
      {expired && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-4">
          Your editor session ended. Unsaved changes are still shown below. Reopen this document
          from your application to continue with the saved draft.
        </p>
      )}
      {runtime && metadata ? (
        <div inert={expired}>
          <QueryClientProvider client={queryClient}>
            <EditorRuntimeContext.Provider value={runtime}>
              {sentId ? (
                <div role="status">
                  <h1 className="text-xl font-semibold">Sent for signing</h1>
                  <p>
                    Recipients will receive signing links by email. your application will receive
                    status updates.
                  </p>
                  <Button className="mt-4" onClick={runtime.close}>
                    Back to your application
                  </Button>
                </div>
              ) : (
                <MemoryRouter
                  initialEntries={[
                    metadata.envelopeId ? runtime.prepare(metadata.envelopeId) : '/upload',
                  ]}
                >
                  <Routes>
                    <Route path="/upload" element={<NewEnvelopePage />} />
                    <Route path="/envelopes/:id/prepare" element={<PreparePage />} />
                    <Route path="/envelopes/:id/review" element={<ReviewPage />} />
                    <Route
                      path="/sent"
                      element={
                        <p>
                          This document has already been sent. Return to your application to view
                          its status.
                        </p>
                      }
                    />
                    <Route path="*" element={<Navigate to="/sent" replace />} />
                  </Routes>
                </MemoryRouter>
              )}
            </EditorRuntimeContext.Provider>
          </QueryClientProvider>
        </div>
      ) : (
        !failure && <p role="status">Waiting for your application…</p>
      )}
    </div>
  );
}
