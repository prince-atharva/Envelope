import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { isTransient, signingApi, withBackoff } from './signing-api';

const TOKEN = 'ab'.repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
});

function failure(status: number): ApiError {
  return new ApiError({
    status,
    code: status >= 500 || status === 0 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT',
    title: 'x',
  });
}

describe('isTransient', () => {
  it('is true only for no connection and server errors', () => {
    expect(isTransient(failure(0))).toBe(true);
    expect(isTransient(failure(503))).toBe(true);
    expect(isTransient(failure(409))).toBe(false);
    expect(isTransient(new Error('x'))).toBe(false);
  });
});

describe('withBackoff', () => {
  it('tries again after 1, 2 and 4 seconds, then gives up', async () => {
    const waits: number[] = [];
    const attempt = vi.fn().mockRejectedValue(failure(0));
    await expect(
      withBackoff(attempt, undefined, async (ms) => {
        waits.push(ms);
      }),
    ).rejects.toMatchObject({ status: 0 });
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('stops as soon as it works', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(failure(502)).mockResolvedValue('ok');
    await expect(withBackoff(attempt, [1], async () => undefined)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never repeats a refusal', async () => {
    const attempt = vi.fn().mockRejectedValue(failure(409));
    await expect(withBackoff(attempt, [1, 1], async () => undefined)).rejects.toMatchObject({
      status: 409,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('signingApi', () => {
  it('sends no cookies, no referrer and nothing cacheable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ consentGivenAt: '2026-09-18T00:00:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await signingApi.consent(TOKEN, { agreed: true, consentTextHash: 'a'.repeat(64) });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/sign/${TOKEN}/consent`);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('turns a problem response into an ApiError carrying its reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'urn:digitalsign:error:envelope-terminal',
            title: 'Envelope is in a terminal state',
            status: 409,
            code: 'ENVELOPE_TERMINAL',
            reason: 'VOIDED',
          }),
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    await expect(signingApi.session(TOKEN)).rejects.toMatchObject({
      code: 'ENVELOPE_TERMINAL',
      reason: 'VOIDED',
      status: 409,
    });
  });

  it('reports a dropped connection as SERVICE_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(signingApi.session(TOKEN)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 0,
    });
  });
});
