import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  HANDOVER_PHOTO_FILE,
  readHandoverPhotoForTenant,
} from '@/lib/lease-reservation-lifecycle-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — a photo of the tenant's own handover record: the premises, the key receipt, defects. */
export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string; file: string }> },
) {
  if (!hasDatabaseUrl()) return new NextResponse(null, { status: 503 });
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { reference, file } = await context.params;
  if (!HANDOVER_PHOTO_FILE.test(file)) return new NextResponse(null, { status: 404 });
  const photo = await readHandoverPhotoForTenant(claims, reference, file).catch(
    (error: unknown) => {
      console.error('GET handover photo failed', error);
      return null;
    },
  );
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
