import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { readTenantRequestPhoto } from '@/lib/tenant-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tenant/requests/:requestId/photos/:index — a photo the tenant attached to a maintenance
 * request or a report, for that tenant or for the landlord's people who may see the request.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string; index: string }> },
) {
  if (!hasDatabaseUrl()) return new NextResponse(null, { status: 503 });
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { requestId, index } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d$/.test(index)) {
    return new NextResponse(null, { status: 404 });
  }
  const photo = await readTenantRequestPhoto(claims, requestId, Number(index)).catch((error) => {
    console.error('GET /api/tenant/requests/:id/photos/:index', error);
    return null;
  });
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
