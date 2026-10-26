import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadGreetingDesignSvg } from '@/lib/greeting-campaigns-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ campaignId: string; designId: string }> };

/**
 * Public SVG for a greeting card version (embedded in outbound email).
 * Ids are unguessable UUIDs; content is festive branding only.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return new NextResponse('unavailable', { status: 503 });
  }
  const { campaignId, designId } = await params;
  if (
    !/^[0-9a-f-]{36}$/i.test(campaignId) ||
    !/^[0-9a-f-]{36}$/i.test(designId)
  ) {
    return new NextResponse('not found', { status: 404 });
  }
  const svg = await loadGreetingDesignSvg(campaignId, designId);
  if (!svg) return new NextResponse('not found', { status: 404 });
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
