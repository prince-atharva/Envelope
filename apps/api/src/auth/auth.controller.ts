import {
  type AuthResponse,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type UserProfile,
} from '@envelope/shared';
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../bootstrap/configure-app';
import { AppException } from '../common/errors/app-exception';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { AppConfig } from '../config/app-config';
import { Client, CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import type { AuthenticatedUser, ClientInfo } from './auth.types';

export const REFRESH_COOKIE = 'ds_refresh';
const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  /** The refresh cookie is only ever sent to /api/v1/auth/*, never to other routes. */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.APP_URL.startsWith('https://'),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private readRefreshCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Create a workspace and its owner account' })
  @ApiBody({ schema: openApiSchema(registerSchema) })
  @ApiCreatedResponse({ description: 'Signed in; refresh cookie set' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(body, client);
    this.setRefreshCookie(res, result.refreshToken);
    return result.response;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  // 10 a minute from one address, and 5 a minute against one account from anywhere.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RateLimit(LIMITS.loginPerAccount)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({ schema: openApiSchema(loginSchema) })
  @ApiOkResponse({ description: 'Signed in; refresh cookie set' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body, client);
    this.setRefreshCookie(res, result.refreshToken);
    return result.response;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token' })
  @ApiOkResponse({ description: 'New access token; refresh cookie rotated' })
  async refresh(
    @Req() req: Request,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken = this.readRefreshCookie(req);
    if (!refreshToken) {
      throw new AppException('SESSION_EXPIRED', 'Please sign in.');
    }
    try {
      const result = await this.auth.refresh(refreshToken, client);
      this.setRefreshCookie(res, result.refreshToken);
      return result.response;
    } catch (error) {
      if (error instanceof AppException && error.code === 'SESSION_EXPIRED') {
        this.clearRefreshCookie(res);
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the current session' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshCookie(req), client);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user and their workspace' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.auth.profile(user.id);
  }
}
