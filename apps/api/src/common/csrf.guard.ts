import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { verifyCsrfToken } from '@bhd-r/security';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (safeMethods.has(request.method) || request.auth?.authenticationMethod !== 'session')
      return true;
    const fetchSite = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const expectedOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
    if (
      (typeof fetchSite === 'string' &&
        !['same-origin', 'same-site', 'none'].includes(fetchSite)) ||
      (typeof origin === 'string' && origin.replace(/\/$/, '') !== expectedOrigin)
    ) {
      throw new ForbiddenException('Cross-site request rejected');
    }
    const header = request.headers['x-csrf-token'];
    const cookie = request.cookies?.bhd_r_csrf;
    if (
      typeof header !== 'string' ||
      header !== cookie ||
      !request.auth ||
      !verifyCsrfToken(
        header,
        request.auth.sid,
        process.env.CSRF_SECRET ?? 'development-csrf-secret-must-be-at-least-32-chars',
      )
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }
    return true;
  }
}
