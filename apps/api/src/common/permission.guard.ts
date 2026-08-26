import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiRequest } from './api-http.js';
import type { Permission } from '@bhd-r/authz';
import { AUTHENTICATED_ROUTE, PUBLIC_ROUTE, REQUIRED_PERMISSIONS } from './decorators.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const authenticated =
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets) ?? false;
    const required = this.reflector.getAllAndOverride<readonly Permission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (!required && !authenticated)
      throw new ForbiddenException('Route authorization policy is not declared');
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (
      !request.auth ||
      required.some((permission) => !request.auth!.permissions.includes(permission))
    ) {
      throw new ForbiddenException('Insufficient permission');
    }
    request.requiredPermissions = required;
    return true;
  }
}
