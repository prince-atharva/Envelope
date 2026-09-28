import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmbedApi } from './embed-api';

afterEach(() => vi.unstubAllGlobals());
describe('embedded transport credentials', () => {
  it('omits cookies, never refreshes and drops credentials after expiration', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'EMBED_SESSION_EXPIRED' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    const expired = vi.fn();
    const client = createEmbedApi('memory-only-secret', expired);
    await expect(client.api.getEnvelope('one')).rejects.toMatchObject({
      code: 'EMBED_SESSION_EXPIRED',
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { Authorization: 'Bearer memory-only-secret' },
    });
    await expect(client.api.getEnvelope('one')).rejects.toMatchObject({
      code: 'EMBED_SESSION_EXPIRED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledOnce();
  });
  it('aborts requests and forgets its bearer when destroyed', async () => {
    const fetch = vi.fn().mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const client = createEmbedApi('temporary', vi.fn());
    const pending = client.api.getEnvelope('one');
    client.destroy();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.api.getEnvelope('one')).rejects.toMatchObject({
      code: 'EMBED_SESSION_EXPIRED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
