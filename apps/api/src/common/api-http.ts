import type { Permission, SessionClaims } from '@bhd-r/authz';
import type { Request, Response } from 'express';

export type AuthClaims = SessionClaims & {
  authenticationMethod: 'session' | 'bearer' | 'api_key';
};

export type ApiRequest = Request & {
  id: string;
  auth?: AuthClaims;
  rawBody?: Buffer;
  requiredPermissions?: readonly Permission[];
  routeOptions?: { url?: string };
};

export type ApiResponse = Response;
