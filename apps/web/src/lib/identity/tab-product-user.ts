import { eq } from 'drizzle-orm';
import { users } from '@bhd-r/db';
import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';
import { getDatabase } from '@/lib/public-booking-neon';

/**
 * Map this tab's identity window Bearer → product `users.id`.
 * Multi-tab Chrome shares one product cookie; sessionStorage tokens stay per-tab, so the
 * handover pass can prove the tenant without winning the cookie race.
 */
export async function productUserIdFromIdentityBearer(
  token: string | null | undefined,
): Promise<string | null> {
  const trimmed = token?.trim() || '';
  if (trimmed.length < 20) return null;
  try {
    const issuer = (
      process.env.BHD_IDENTITY_ISSUER?.trim() || DEFAULT_IDENTITY_ISSUER
    ).replace(/\/$/, '');
    const response = await fetch(`${issuer}/api/auth/me`, {
      headers: { Authorization: `Bearer ${trimmed}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      user?: { id?: string } | null;
    };
    const identitySub = body.user?.id?.trim();
    if (!identitySub) return null;
    const { db } = getDatabase();
    const row = await db.query.users.findFirst({
      where: eq(users.identitySubject, identitySub),
      columns: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export function identityBearerFromRequest(request: Request): string | null {
  const dedicated = request.headers.get('x-bhd-identity-bearer')?.trim();
  if (dedicated && dedicated.length >= 20) return dedicated;
  return null;
}
