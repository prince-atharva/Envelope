import {
  type AuthResponse,
  type EnvelopeDetail,
  type EnvelopeListResponse,
  type ErrorCode,
  isErrorCode,
  type LoginInput,
  type ProblemDetails,
  type ProblemFieldError,
  type RegisterInput,
  type UserProfile,
} from '@digitalsign/shared';

const API_BASE = '/api/v1';

/** Refresh a minute before the access token expires. */
const REFRESH_MARGIN_SECONDS = 60;
/** Another tab may have just rotated the refresh cookie; wait this long and try once more. */
const REFRESH_RACE_DELAY_MS = 400;

/** An API error, carrying the RFC 7807 problem details the server returned. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly requestId?: string;
  readonly fieldErrors: ProblemFieldError[];

  constructor(
    problem: Pick<ProblemDetails, 'status' | 'code' | 'title'> & Partial<ProblemDetails>,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.requestId = problem.requestId;
    this.fieldErrors = problem.errors ?? [];
  }
}

function networkError(): ApiError {
  return new ApiError({
    status: 0,
    code: 'SERVICE_UNAVAILABLE',
    title: 'Cannot reach the server',
  });
}

function toApiError(body: unknown, status: number, requestId: string | undefined): ApiError {
  const problem = body as Partial<ProblemDetails> | null;
  if (problem && isErrorCode(problem.code)) {
    return new ApiError({
      ...problem,
      status,
      code: problem.code,
      title: problem.title ?? 'Request failed',
      requestId: problem.requestId ?? requestId,
    });
  }
  return new ApiError({
    status,
    code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    title: 'Request failed',
    requestId,
  });
}

// ─── Session state (memory only; the refresh token is an httpOnly cookie) ───

type SessionListener = (session: AuthResponse | null) => void;

let accessToken: string | null = null;
let lastRequestId: string | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
const listeners = new Set<SessionListener>();

/** The id of the most recent API request, attached to browser error reports. */
export function getLastRequestId(): string | undefined {
  return lastRequestId;
}

export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSession(session: AuthResponse | null): void {
  accessToken = session?.accessToken ?? null;
  clearTimeout(refreshTimer);
  if (session) {
    const delaySeconds = Math.max(session.expiresIn - REFRESH_MARGIN_SECONDS, 5);
    refreshTimer = setTimeout(
      () => void refreshSession({ retryOnRace: true }),
      delaySeconds * 1000,
    );
  }
  for (const listener of listeners) listener(session);
}

// ─── Requests ───

function withStandardHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers(init);
  headers.set('X-Request-Id', crypto.randomUUID());
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return headers;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: withStandardHeaders(init.headers),
      credentials: 'same-origin',
    });
  } catch {
    throw networkError();
  }
  lastRequestId = res.headers.get('X-Request-Id') ?? lastRequestId;
  return res;
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  return toApiError(body, res.status, res.headers.get('X-Request-Id') ?? undefined);
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share
 * one request. Resolves to null when there is no valid session.
 */
export function refreshSession(options: { retryOnRace: boolean }): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const res = await send('/auth/refresh', { method: 'POST' });
        if (res.ok) {
          const session = (await res.json()) as AuthResponse;
          setSession(session);
          return session;
        }
        if (res.status !== 401 || !options.retryOnRace || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RACE_DELAY_MS));
      }
      setSession(null);
      return null;
    } catch {
      // Offline: keep the current state and let the next request try again.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** fetch() for the API: auth header, request id, one silent refresh on 401, problem errors. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await send(path, init);
  if (res.status === 401 && accessToken !== null) {
    const session = await refreshSession({ retryOnRace: true });
    if (session) res = await send(path, init);
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  return (await res.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ─── Uploads (XMLHttpRequest, for progress events) ───

interface XhrResult {
  status: number;
  body: unknown;
  requestId?: string;
}

function xhrPost(path: string, form: FormData, onProgress?: (fraction: number) => void) {
  return new Promise<XhrResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    withStandardHeaders(undefined).forEach((value, name) => {
      xhr.setRequestHeader(name, value);
    });
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        body: xhr.response as unknown,
        requestId: xhr.getResponseHeader('X-Request-Id') ?? undefined,
      });
    xhr.onerror = () => reject(networkError());
    xhr.send(form);
  });
}

async function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void) {
  let result = await xhrPost(path, form, onProgress);
  if (result.status === 401 && accessToken !== null) {
    if (await refreshSession({ retryOnRace: true })) result = await xhrPost(path, form, onProgress);
  }
  lastRequestId = result.requestId ?? lastRequestId;
  if (result.status < 200 || result.status >= 300) {
    throw toApiError(result.body, result.status, result.requestId);
  }
  return result.body as T;
}

// ─── Endpoints ───

export const api = {
  async register(input: RegisterInput): Promise<AuthResponse> {
    const session = await json<AuthResponse>('/auth/register', jsonBody(input));
    setSession(session);
    return session;
  },

  async login(input: LoginInput): Promise<AuthResponse> {
    const session = await json<AuthResponse>('/auth/login', jsonBody(input));
    setSession(session);
    return session;
  },

  async logout(): Promise<void> {
    try {
      await send('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
    }
  },

  me: () => json<UserProfile>('/auth/me'),

  listEnvelopes: (cursor?: string) =>
    json<EnvelopeListResponse>(
      `/envelopes?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  getEnvelope: (id: string) => json<EnvelopeDetail>(`/envelopes/${encodeURIComponent(id)}`),

  async downloadDocument(id: string, version = 0): Promise<ArrayBuffer> {
    const res = await apiFetch(`/envelopes/${encodeURIComponent(id)}/file?version=${version}`);
    return res.arrayBuffer();
  },

  uploadEnvelope(file: File, title: string | undefined, onProgress?: (fraction: number) => void) {
    const form = new FormData();
    if (title) form.append('title', title);
    form.append('file', file);
    return upload<EnvelopeDetail>('/envelopes', form, onProgress);
  },
};
