import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadGreetingDesignAsset } from '@/lib/greeting-campaigns-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ campaignId: string; designId: string }> };

/**
 * Public greeting-card image for email embed + admin preview.
 * Prefers AI JPEG; falls back to SVG. Ids are unguessable UUIDs.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return new NextResponse('unavailable', { status: 503 });
  }
  const { campaignId, designId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !/^[0-9a-f-]{36}$/i.test(designId)) {
    return new NextResponse('not found', { status: 404 });
  }
  const asset = await loadGreetingDesignAsset(campaignId, designId);
  if (!asset) return new NextResponse('not found', { status: 404 });
  return new NextResponse(new Uint8Array(asset.body), {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
