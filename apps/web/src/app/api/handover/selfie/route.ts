import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readHandoverSelfie, type HandoverKey } from '@/lib/lease-reservation-lifecycle-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/handover/selfie?t=… (or ?ref=…&code=…) — the selfie the tenant took when signing
 * (or, with `live=1`, the one just taken at the door), for the staff member at the door, only
 * while the scanned pass is live.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) return new NextResponse(null, { status: 503 });
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const query = new URL(request.url).searchParams;
  const token = query.get('t');
  const reference = query.get('ref');
  const code = query.get('code');
  const key: HandoverKey | null =
    token && token.length <= 120
      ? { token }
      : reference && code && /^\d{6}$/.test(code)
        ? { reference, code }
        : null;
  if (!key) return new NextResponse(null, { status: 404 });
  const which = query.get('live') === '1' ? 'live' : 'signing';
  const photo = await readHandoverSelfie(claims, key, which).catch(() => null);
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      'content-type': photo.mimeType,
      'cache-control': 'private, no-store',
      'content-security-policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}
