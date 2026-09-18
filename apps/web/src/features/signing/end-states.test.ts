import type { ErrorCode } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { endStateFor } from './end-states';

function apiError(code: ErrorCode, status: number, reason?: string): ApiError {
  return new ApiError({ status, code, title: code, reason });
}

describe('endStateFor', () => {
  it('gives every refusal of the link its own screen', () => {
    expect(endStateFor(apiError('TOKEN_INVALID', 401))).toEqual({ kind: 'invalid' });
    expect(endStateFor(apiError('TOKEN_EXPIRED', 401))).toEqual({ kind: 'expired' });
    expect(endStateFor(apiError('TOKEN_ALREADY_USED', 410))).toEqual({ kind: 'already-signed' });
  });

  it('tells cancelled, declined by someone else and declined by you apart', () => {
    expect(endStateFor(apiError('ENVELOPE_TERMINAL', 409, 'VOIDED'))).toEqual({
      kind: 'cancelled',
    });
    expect(endStateFor(apiError('ENVELOPE_TERMINAL', 409, 'DECLINED'))).toEqual({
      kind: 'declined-by-other',
    });
    expect(endStateFor(apiError('ENVELOPE_TERMINAL', 409, 'YOU_DECLINED'))).toEqual({
      kind: 'you-declined',
      justNow: false,
    });
    expect(endStateFor(apiError('ENVELOPE_TERMINAL', 409))).toEqual({ kind: 'closed' });
    expect(endStateFor(apiError('ENVELOPE_TERMINAL', 409, 'toString'))).toEqual({
      kind: 'closed',
    });
  });

  it('leaves recoverable failures to the screen that made the request', () => {
    expect(endStateFor(apiError('SERVICE_UNAVAILABLE', 0))).toBeNull();
    expect(endStateFor(apiError('RATE_LIMITED', 429))).toBeNull();
    expect(endStateFor(apiError('INVALID_SIGNATURE_IMAGE', 422))).toBeNull();
    expect(endStateFor(new Error('boom'))).toBeNull();
    expect(endStateFor(null)).toBeNull();
  });
});
