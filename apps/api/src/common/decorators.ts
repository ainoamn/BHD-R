import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@bhd-r/authz';

export const PUBLIC_ROUTE = Symbol('public-route');
export const REQUIRED_PERMISSIONS = Symbol('required-permissions');
export const IDEMPOTENT_ROUTE = Symbol('idempotent-route');
export const AUTHENTICATED_ROUTE = Symbol('authenticated-route');

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
export const Idempotent = () => SetMetadata(IDEMPOTENT_ROUTE, true);
export const Authenticated = () => SetMetadata(AUTHENTICATED_ROUTE, true);
