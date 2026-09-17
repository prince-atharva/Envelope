import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../common/errors/app-exception';
import type { AuthenticatedUser, ClientInfo } from './auth.types';

export const IS_PUBLIC_KEY = 'digitalsign:isPublic';

/** Opts a controller or route out of the global JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** The signed-in sender. Only valid on routes protected by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw new AppException('UNAUTHENTICATED');
    return user;
  },
);

export function clientInfoFrom(req: Request): ClientInfo {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
  };
}

/** Where the request came from: the client IP and user agent. */
export const Client = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientInfo =>
    clientInfoFrom(context.switchToHttp().getRequest<Request>()),
);
