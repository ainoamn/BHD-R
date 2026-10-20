import { NextResponse } from 'next/server';
import { EMPTY_TENANCY } from '@/lib/tenancy-shared';
import { loadMyTenancy, loadMyTenantBadges } from '@/lib/tenancy-neon';
import { getViewer } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/tenant/space — full tenant bookings/contracts payload for soft-nav cache. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !viewer.portals.includes('tenant')) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  let failed = false;
  const [data, badges] = await Promise.all([
    loadMyTenancy(viewer.id).catch((error: unknown) => {
      console.error('tenant space api failed', error);
      failed = true;
      return EMPTY_TENANCY;
    }),
    loadMyTenantBadges(viewer.id).catch(() => []),
  ]);
  return NextResponse.json(
    {
      data,
      badges,
      displayName: viewer.displayName,
      ownerPortal:
        viewer.portals.find((portal) => portal === 'owner' || portal === 'developer') ?? null,
      failed,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
