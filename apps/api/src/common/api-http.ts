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
  /** cookie-parser; narrowed so guards/controllers avoid `any` cookie bags. */
  cookies: Partial<Record<string, string>>;
};

/** Read a single cookie as a string (ignores non-string values). */
export function readCookie(request: ApiRequest, name: string): string | undefined {
  const bag: unknown = Reflect.get(request, 'cookies');
  if (!bag || typeof bag !== 'object') return undefined;
  const value: unknown = Reflect.get(bag, name);
  return typeof value === 'string' ? value : undefined;
}

export type ApiResponse = Response;
