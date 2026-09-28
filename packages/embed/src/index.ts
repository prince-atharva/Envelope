import { EMBED_PROTOCOL_VERSION, type EmbedEvent, embedEventSchema } from '@envelope/shared';

export type { EmbedEvent } from '@envelope/shared';
export interface EnvelopeEditorOptions {
  container: HTMLElement;
  frameUrl: string;
  launchToken: string;
  onEvent?: (event: EmbedEvent) => void;
  timeoutMs?: number;
}
export interface EnvelopeEditor {
  requestClose(): void;
  /** Removes the frame immediately. Revoke the session on your backend; saving is not guaranteed. */
  destroy(): void;
}

export function createEnvelopeEditor(options: EnvelopeEditorOptions): EnvelopeEditor {
  const url = new URL(options.frameUrl);
  const match = /^\/api\/v1\/embed\/frame\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (
    !match?.[1] ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    )
  ) {
    throw new Error('Use the frameUrl returned by the Envelope session API');
  }
  if (!/^eel_[a-f0-9]{64}$/.test(options.launchToken)) throw new Error('Invalid launch credential');
  const sessionId = match[1];
  const origin = url.origin;
  let launchToken: string | null = options.launchToken;
  const onEvent = options.onEvent;
  const frame = document.createElement('iframe');
  frame.title = 'Envelope document editor';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  let destroyed = false;
  let handedOff = false;
  const timer = setTimeout(() => {
    if (!handedOff && !destroyed) {
      launchToken = null;
      onEvent?.({
        version: EMBED_PROTOCOL_VERSION,
        sessionId,
        type: 'error',
        code: 'EMBED_SESSION_EXPIRED',
      });
    }
  }, options.timeoutMs ?? 60_000);
  function receive(message: MessageEvent) {
    if (destroyed || message.source !== frame.contentWindow || message.origin !== origin) return;
    const parsed = embedEventSchema.safeParse(message.data);
    if (!parsed.success || parsed.data.sessionId !== sessionId) return;
    if (parsed.data.type === 'ready') {
      if (handedOff || !launchToken) return;
      handedOff = true;
      clearTimeout(timer);
      frame.contentWindow?.postMessage(
        { version: EMBED_PROTOCOL_VERSION, sessionId, type: 'launch', launchToken },
        origin,
      );
      launchToken = null;
    }
    onEvent?.(parsed.data);
  }
  window.addEventListener('message', receive);
  frame.src = url.href;
  options.container.appendChild(frame);
  return {
    requestClose() {
      if (!destroyed)
        frame.contentWindow?.postMessage(
          { version: EMBED_PROTOCOL_VERSION, sessionId, type: 'request.close' },
          origin,
        );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      launchToken = null;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      frame.remove();
    },
  };
}
