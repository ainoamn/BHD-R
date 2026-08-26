import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { ApiRequest } from './api-http.js';
import { verifyCsrfToken } from '@bhd-r/security';
import { isAllowedWebOrigin } from './web-origins.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (safeMethods.has(request.method) || request.auth?.authenticationMethod !== 'session')
      return true;

    const fetchSite = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;

    // Explicit cross-site browser navigation/fetch is never allowed for cookie sessions.
    if (typeof fetchSite === 'string' && fetchSite === 'cross-site') {
      throw new ForbiddenException('Cross-site request rejected');
    }

    // same-origin / same-site: page host matched (Next rewrite/BFF). Preview Origin may differ
    // from WEB_ORIGIN — do not reject solely on Origin.
    const browserSameSite =
      typeof fetchSite === 'string' &&
      (fetchSite === 'same-origin' || fetchSite === 'same-site');

    if (!browserSameSite && typeof origin === 'string' && !isAllowedWebOrigin(origin)) {
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
