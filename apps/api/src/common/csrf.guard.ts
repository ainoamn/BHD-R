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
