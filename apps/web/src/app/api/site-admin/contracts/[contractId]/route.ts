import { getAdminContractInspect } from '@/lib/site-admin-users-neon';
import { siteAdminRead } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/contracts/:id — read-only contract dossier for site admins. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;
  return siteAdminRead(request, 'GET /api/site-admin/contracts/:id', async (claims) => ({
    contract: await getAdminContractInspect(claims, contractId),
  }));
}