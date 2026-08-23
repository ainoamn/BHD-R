import type { Permission, SessionClaims } from '@bhd-r/authz';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SessionClaims & { authenticationMethod: 'session' | 'bearer' | 'api_key' };
    rawBody?: Buffer;
    requiredPermissions?: readonly Permission[];
  }
}
