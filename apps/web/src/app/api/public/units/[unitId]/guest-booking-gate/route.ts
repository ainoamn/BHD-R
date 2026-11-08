import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { listings, properties, units } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { getDatabase, withElevatedRead } from '@/lib/public-booking-neon';
import { assertMayBookAsGuest } from '@/lib/own-property-booking';
import { viewerOperatesOrganization } from '@/lib/portal-access';
import { getViewer } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/units/:unitId/guest-booking-gate
 * Tells the listing page whether the signed-in account owns/operates this unit.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ unitId: string }> },
) {
  const { unitId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const viewer = await getViewer().catch(() => null);
  if (!viewer) {
    return NextResponse.json({ ownProperty: false, signedIn: false });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ownProperty: false, signedIn: true });
  }

  try {
    const { db } = getDatabase();
    const ownProperty = await db.transaction(async (transaction) => {
      const preview = await withElevatedRead(transaction, async () => {
        const rows = await transaction
          .select({
            organizationId: units.organizationId,
            ownerPartyId: properties.ownerPartyId,
          })
          .from(units)
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .leftJoin(listings, eq(listings.unitId, units.id))
          .where(and(eq(units.id, unitId)))
          .limit(1);
        return rows[0] ?? null;
      });
      if (!preview) return false;
      if (viewerOperatesOrganization(viewer, preview.organizationId)) return true;
      try {
        await assertMayBookAsGuest(transaction, {
          userId: viewer.id,
          organizationId: preview.organizationId,
          sessionOrganizationId: viewer.organizationId,
          roles: viewer.roles,
          partyId: viewer.partyId,
          email: viewer.email ?? null,
          ownerPartyId: preview.ownerPartyId,
        });
        return false;
      } catch (error) {
        return error instanceof Error && error.message === 'own_property';
      }
    });
    return NextResponse.json({ ownProperty, signedIn: true });
  } catch {
    return NextResponse.json({ ownProperty: false, signedIn: true });
  }
}
