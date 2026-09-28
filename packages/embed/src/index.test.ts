import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnvelopeEditor } from './index.js';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
function setup() {
  const target = new EventTarget();
  const frame = {
    title: '',
    referrerPolicy: '',
    src: '',
    style: {},
    setAttribute: vi.fn(),
    contentWindow: { postMessage: vi.fn() },
    remove: vi.fn(),
  };
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', { createElement: () => frame });
  const container = { appendChild: vi.fn() } as unknown as HTMLElement;
  const onEvent = vi.fn();
  const editor = createEnvelopeEditor({
    container,
    frameUrl: `https://envelope.example/api/v1/embed/frame/${sessionId}`,
    launchToken: `eel_${'a'.repeat(64)}`,
    onEvent,
    timeoutMs: 10_000,
  });
  const message = (
    origin = 'https://envelope.example',
    source: unknown = frame.contentWindow,
    data: unknown = { version: 1, sessionId, type: 'ready' },
  ) => {
    const event = new Event('message');
    Object.assign(event, { origin, source, data });
    target.dispatchEvent(event);
  };
  return { editor, frame, message, onEvent };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Envelope SDK handshake', () => {
  it('ignores wrong origins, windows, sessions and protocol versions', () => {
    const { editor, frame, message, onEvent } = setup();
    message('https://attacker.example');
    message(undefined, {});
    message(undefined, undefined, { version: 2, sessionId, type: 'ready' });
    message(undefined, undefined, {
      version: 1,
      sessionId: '223e4567-e89b-42d3-a456-426614174000',
      type: 'ready',
    });
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    message();
    message();
    expect(frame.contentWindow.postMessage).toHaveBeenCalledOnce();
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[1]).toBe('https://envelope.example');
    editor.destroy();
  });
  it('cleans up listeners and ignores messages after destruction', () => {
    const { editor, frame, message, onEvent } = setup();
    editor.requestClose();
    expect(frame.contentWindow.postMessage.mock.calls[0]?.[0].type).toBe('request.close');
    editor.destroy();
    editor.destroy();
    message();
    editor.requestClose();
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(frame.contentWindow.postMessage).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('drops a launch that never gets a ready handshake', () => {
    vi.useFakeTimers();
    const { editor, frame, message, onEvent } = setup();
    vi.advanceTimersByTime(10_000);
    message();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', code: 'EMBED_SESSION_EXPIRED' }),
    );
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    editor.destroy();
  });
  it('keeps another frame from opening its session', () => {
    const { editor, frame, message, onEvent } = setup();
    message(undefined, { postMessage: vi.fn() });
    expect(onEvent).not.toHaveBeenCalled();
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    message();
    expect(onEvent).toHaveBeenCalledOnce();
    editor.destroy();
  });
});
