import type { AuthClaims } from './common/api-http.js';
import type { Permission } from '@bhd-r/authz';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      auth?: AuthClaims;
      rawBody?: Buffer;
      requiredPermissions?: readonly Permission[];
      routeOptions?: { url?: string };
    }
  }
}

export {};
