import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { requireSessionSecret } from '@/lib/runtime-env';
import { loadAllOperationsWorkspacePayloads } from '@/lib/portal-ops-workspace';
import type { PortalRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Background warm of every ops section — allow Nest races without hanging the UI. */
export const maxDuration = 60;

const PORTALS = new Set<PortalRole>(['owner', 'developer', 'tenant', 'platform']);

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

function portalsForRoles(roles: readonly string[]): PortalRole[] {
  const portalSet = new Set<PortalRole>();
  if (roles.some((role) => role === 'platform_admin' || role === 'platform_support'))
    portalSet.add('platform');
  if (roles.includes('developer_admin')) portalSet.add('developer');
  if (roles.includes('tenant')) portalSet.add('tenant');
  if (
    roles.some((role) =>
      [
        'organization_owner',
        'organization_admin',
        'property_manager',
        'finance_manager',
        'maintenance_agent',
        'auditor',
      ].includes(role),
    )
  )
    portalSet.add('owner');
  return [...portalSet];
}

/**
 * GET /api/portal/ops/:portal/warm
 * Load every ops section once so client soft-nav paints from memory.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ portal: string }> },
) {
  const { portal: portalRaw } = await context.params;
  if (!PORTALS.has(portalRaw as PortalRole)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const portal = portalRaw as PortalRole;

  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  const allowed = portalsForRoles(claims.roles);
  if (!allowed.includes(portal)) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const locale = claims.locale === 'en' ? 'en' : 'ar';
  const sections = await loadAllOperationsWorkspacePayloads(portal, locale);
  return NextResponse.json(
    { sections },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
