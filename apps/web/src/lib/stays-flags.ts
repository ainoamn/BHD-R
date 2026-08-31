import 'server-only';
import { readStaysFlagsFromEnv, staysPublicSurfaceEnabled } from '@bhd-r/config';

/** Portal stays nav / pages — platform kill-switch only. */
export function isStaysPlatformEnabled(): boolean {
  return readStaysFlagsFromEnv().platformEnabled;
}

/** Public `/stays` + homepage stay tab. */
export function isStaysPublicSurfaceEnabled(): boolean {
  return staysPublicSurfaceEnabled();
}
