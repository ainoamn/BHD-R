import 'server-only';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@bhd-r/authz';
import type { SessionClaims } from '@bhd-r/authz';
import { requireSessionSecret } from '@/lib/runtime-env';

/** Shared cookie session reader for stay setup Neon loaders. */
export async function readSessionClaimsFromCookies(): Promise<SessionClaims | null> {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token, requireSessionSecret());
  } catch {
    return null;
  }
}
