import { getAdminPropertyInspect } from '@/lib/site-admin-users-neon';
import { siteAdminRead } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/properties/:id — read-only property dossier for site admins. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  return siteAdminRead(request, 'GET /api/site-admin/properties/:id', async (claims) => ({
    property: await getAdminPropertyInspect(claims, propertyId),
  }));
}
