import { isErrorCode } from '@envelope/shared';
import { ApiError } from '../../lib/api';
import type { EditorApi } from './editor-runtime';

export function createEmbedApi(initialToken: string, onExpired: () => void) {
  let token: string | null = initialToken;
  const controllers = new Set<AbortController>();
  async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    revision?: number,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!token)
      throw new ApiError({
        status: 401,
        code: 'EMBED_SESSION_EXPIRED',
        title: 'Editor session ended',
      });
    const controller = new AbortController();
    controllers.add(controller);
    const form = body instanceof FormData;
    try {
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
          ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });
      if (!token)
        throw new ApiError({
          status: 401,
          code: 'EMBED_SESSION_EXPIRED',
          title: 'Editor session ended',
        });
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { code?: string; title?: string };
        if (res.status === 401) {
          token = null;
          onExpired();
        }
        throw new ApiError({
          status: res.status,
          code: isErrorCode(problem.code) ? problem.code : 'INTERNAL_ERROR',
          title: problem.title ?? 'Editor request failed',
        });
      }
      if (res.status === 204) return undefined as T;
      return (path.includes('/file?') ? await res.arrayBuffer() : await res.json()) as T;
    } finally {
      controllers.delete(controller);
    }
  }
  const envelopePath = (id: string) => `/envelopes/${encodeURIComponent(id)}`;
  const api: EditorApi = {
    getEnvelope: (id) => request(envelopePath(id)),
    downloadDocument: (id, version = 0) => request(`${envelopePath(id)}/file?version=${version}`),
    uploadEnvelope: async (file, title, documentCategory, onProgress) => {
      const form = new FormData();
      form.append('file', file);
      form.append('documentCategory', documentCategory);
      if (title) form.append('title', title);
      const result = await request<Awaited<ReturnType<EditorApi['uploadEnvelope']>>>(
        '/embed/session/envelope',
        'POST',
        form,
      );
      onProgress?.(1);
      return result;
    },
    updateEnvelope: (id, input, revision) => request(envelopePath(id), 'PATCH', input, revision),
    addRecipient: (id, input, revision) =>
      request(`${envelopePath(id)}/recipients`, 'POST', input, revision),
    updateRecipient: (id, rid, input, revision) =>
      request(
        `${envelopePath(id)}/recipients/${encodeURIComponent(rid)}`,
        'PATCH',
        input,
        revision,
      ),
    removeRecipient: (id, rid, revision) =>
      request(
        `${envelopePath(id)}/recipients/${encodeURIComponent(rid)}`,
        'DELETE',
        undefined,
        revision,
      ),
    saveFields: (id, fields, revision) =>
      request(`${envelopePath(id)}/fields`, 'PUT', { fields }, revision),
    sendEnvelope: (id, input, key) =>
      request(`${envelopePath(id)}/send`, 'POST', input, undefined, key),
  };
  return {
    api,
    close: () => request<void>('/embed/session/close', 'POST'),
    destroy: () => {
      token = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
