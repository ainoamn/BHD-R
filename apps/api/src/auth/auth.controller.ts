import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { permissionSchema } from '@bhd-r/authz';
import { createCsrfToken } from '@bhd-r/security';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type IssuedSession } from './auth.service.js';
import { Authenticated, Public, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(256),
  organizationId: z.uuid().optional(),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const credentialSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(12).max(256),
});
const resetRequestSchema = z.object({ email: z.email().max(320) });
const totpSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(permissionSchema).min(1).max(50),
  expiresAt: z.iso.datetime().optional(),
});

function setSessionCookies(reply: FastifyReply, issued: IssuedSession): void {
  const secure = secureCookies();
  reply.setCookie('bhd_r_session', issued.token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  reply.setCookie('bhd_r_csrf', issued.csrf, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
}

function secureCookies(): boolean {
  return (
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production')
  );
}

function oidcCookieSecret(): string {
  return process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters';
}

function sealOidcState(value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', oidcCookieSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function openOidcState(value: string): unknown {
  const [payload, supplied, extra] = value.split('.');
  if (!payload || !supplied || extra) throw new Error('Malformed OIDC state');
  const expected = createHmac('sha256', oidcCookieSecret()).update(payload).digest('base64url');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new Error('OIDC state signature mismatch');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('password/login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const issued = await this.authService.login(body);
    setSessionCookies(reply, issued);
    return { user: issued.claims };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('activate')
  async activate(
    @Body(new ZodPipe(credentialSchema)) body: z.infer<typeof credentialSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const issued = await this.authService.activate(body.token, body.password);
    setSessionCookies(reply, issued);
    return { user: issued.claims };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  async forgot(@Body(new ZodPipe(resetRequestSchema)) body: z.infer<typeof resetRequestSchema>) {
    await this.authService.requestPasswordReset(body.email);
    return { accepted: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/reset')
  async reset(@Body(new ZodPipe(credentialSchema)) body: z.infer<typeof credentialSchema>) {
    await this.authService.resetPassword(body.token, body.password);
    return { changed: true };
  }

  @Authenticated()
  @Post('logout')
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.authService.revokeCurrent(request.auth!);
    reply.clearCookie('bhd_r_session', { path: '/' });
    reply.clearCookie('bhd_r_csrf', { path: '/' });
    return { revoked: true };
  }

  /** JSON session for Next `/api/auth/bhd/callback` (cookies must be set on the web origin). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('identity/session')
  async identitySession(
    @Body(
      new ZodPipe(
        z.object({
          idToken: z.string().min(20),
          nonce: z.string().min(8),
          organizationId: z.uuid().optional(),
        }),
      ),
    )
    body: { idToken: string; nonce: string; organizationId?: string },
  ) {
    const issued = await this.authService.loginWithIdentity(
      body.idToken,
      body.organizationId,
      body.nonce,
    );
    return { token: issued.token, csrf: issued.csrf, user: issued.claims };
  }

  @Post('sessions/revoke-all')
  @Authenticated()
  async revoke(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.authService.revokeAll(request.auth!);
    reply.clearCookie('bhd_r_session', { path: '/' });
    reply.clearCookie('bhd_r_csrf', { path: '/' });
    return { revoked: true };
  }

  @Authenticated()
  @Get('csrf')
  csrf(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = createCsrfToken(
      request.auth!.sid,
      process.env.CSRF_SECRET ?? 'development-csrf-secret-must-be-at-least-32-chars',
    );
    reply.setCookie('bhd_r_csrf', token, {
      httpOnly: false,
      secure: secureCookies(),
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    return { token };
  }

  @Post('totp/enroll')
  @Authenticated()
  async enrollTotp(@Req() request: FastifyRequest) {
    return this.authService.beginTotp(request.auth!);
  }

  @Post('totp/confirm')
  @Authenticated()
  async confirmTotp(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(totpSchema)) body: z.infer<typeof totpSchema>,
  ) {
    await this.authService.confirmTotp(request.auth!, body.code);
    return { confirmed: true };
  }

  @RequirePermissions('api_key.write')
  @Post('api-keys')
  async createApiKey(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(apiKeySchema)) body: z.infer<typeof apiKeySchema>,
  ) {
    return this.authService.createApiKey(request.auth!, {
      name: body.name,
      scopes: body.scopes,
      ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
    });
  }

  @Public()
  @Get('oidc/start')
  async oidcStart(
    @Query('returnTo') requestedReturnTo: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const issuer = (process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com').replace(/\/$/, '');
    const clientId =
      process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
    const redirectUri =
      process.env.BHD_OAUTH_REDIRECT_URI ??
      process.env.BHD_IDENTITY_REDIRECT_URI ??
      'http://localhost:3000/api/auth/bhd/callback';
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const returnTo =
      requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
        ? requestedReturnTo
        : '/ar/owner';
    const cookie = sealOidcState({ state, nonce, verifier, returnTo });
    reply.setCookie('bhd_r_oidc', cookie, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path: '/v1/auth/oidc',
      maxAge: 600,
    });
    const authorization = new URL(`${issuer}/oauth/authorize`);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return reply.redirect(authorization.toString());
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const rawCookie = request.cookies?.bhd_r_oidc;
    if (!rawCookie)
      return reply.status(400).send({
        error: {
          code: 'OIDC_STATE_MISSING',
          message: 'Login state is missing',
          requestId: request.id,
        },
      });
    reply.clearCookie('bhd_r_oidc', { path: '/v1/auth/oidc' });
    const saved = z
      .object({ state: z.string(), nonce: z.string(), verifier: z.string(), returnTo: z.string() })
      .parse(openOidcState(rawCookie));
    if (saved.state !== state || !code)
      return reply.status(400).send({
        error: {
          code: 'OIDC_STATE_INVALID',
          message: 'Login state is invalid',
          requestId: request.id,
        },
      });
    const issuer = (process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com').replace(/\/$/, '');
    const clientId =
      process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
    const clientSecret =
      process.env.BHD_OAUTH_CLIENT_SECRET ?? process.env.BHD_IDENTITY_CLIENT_SECRET ?? '';
    const redirectUri =
      process.env.BHD_OAUTH_REDIRECT_URI ??
      process.env.BHD_IDENTITY_REDIRECT_URI ??
      'http://localhost:3000/api/auth/bhd/callback';
    const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!discoveryResponse.ok) throw new Error('Unable to load identity discovery document');
    const discovery = z.object({ token_endpoint: z.url() }).parse(await discoveryResponse.json());
    const issuerUrl = new URL(issuer);
    const tokenEndpoint = new URL(discovery.token_endpoint);
    if (
      (process.env.NODE_ENV === 'production' && tokenEndpoint.protocol !== 'https:') ||
      tokenEndpoint.origin !== issuerUrl.origin
    )
      throw new Error('Unsafe identity token endpoint');
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: saved.verifier,
      }),
    });
    if (!tokenResponse.ok) throw new Error('Identity token exchange failed');
    const tokens = z.object({ id_token: z.string() }).parse(await tokenResponse.json());
    const issued = await this.authService.loginWithIdentity(
      tokens.id_token,
      undefined,
      saved.nonce,
    );
    setSessionCookies(reply, issued);
    return reply.redirect(
      new URL(saved.returnTo, process.env.WEB_ORIGIN ?? 'http://localhost:3000').toString(),
    );
  }
}

@Controller('v1/me')
export class MeController {
  constructor(private readonly authService: AuthService) {}
  @Authenticated()
  @Get()
  me(@Req() request: FastifyRequest) {
    return this.authService.me(request.auth!);
  }
}
