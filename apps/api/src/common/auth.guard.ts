import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiRequest } from './api-http.js';
import { PUBLIC_ROUTE } from './decorators.js';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      request.auth = await this.authService.authenticateApiKey(apiKey);
      return true;
    }

    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const cookieToken = request.cookies?.bhd_r_session;
    const token = bearer ?? cookieToken;
    if (!token) throw new UnauthorizedException('Authentication is required');
    request.auth = await this.authService.authenticateSession(token, bearer ? 'bearer' : 'session');

    const selectedOrganization = request.headers['x-organization-id'];
    if (
      typeof selectedOrganization === 'string' &&
      selectedOrganization !== request.auth.organizationId
    ) {
      if (!request.auth.roles.includes('platform_admin'))
        throw new UnauthorizedException('Organization context mismatch');
      request.auth = { ...request.auth, organizationId: selectedOrganization };
    }
    return true;
  }
}
