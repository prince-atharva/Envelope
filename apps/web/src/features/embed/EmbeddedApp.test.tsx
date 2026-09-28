import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import EmbeddedApp from './EmbeddedApp';

vi.mock('../../pages/NewEnvelopePage', () => ({ NewEnvelopePage: () => <p>Upload editor</p> }));
vi.mock('../../pages/PreparePage', () => ({ PreparePage: () => <p>Draft editor</p> }));
vi.mock('../../pages/ReviewPage', () => ({ ReviewPage: () => <p>Review editor</p> }));
const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const origin = 'https://healthprohub.example';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
it('revokes a late exchange instead of activating an editor after closure', async () => {
  document.body.innerHTML = `<script id="embed-bootstrap" type="application/json">${JSON.stringify({ sessionId, parentOrigin: origin })}</script>`;
  let resolve!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  render(<EmbeddedApp />);
  const message = (data: object) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        origin,
        data: { version: 1, sessionId, ...data },
      }),
    );
  act(() => {
    message({ type: 'launch', launchToken: `eel_${'a'.repeat(64)}` });
  });
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ sessionId });
  await act(async () => {
    message({ type: 'request.close' });
  });
  expect(screen.getByText(/Editor closed/)).toBeTruthy();
  await act(async () => {
    resolve(
      new Response(
        JSON.stringify({
          accessToken: `eea_${'b'.repeat(64)}`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          envelopeId: null,
          mode: 'upload',
          actions: ['edit'],
        }),
      ),
    );
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1]?.[0]).toBe('/api/v1/embed/session/close');
  expect(screen.queryByText('Upload editor')).toBeNull();
  act(() => {
    message({ type: 'launch', launchToken: `eel_${'c'.repeat(64)}` });
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
