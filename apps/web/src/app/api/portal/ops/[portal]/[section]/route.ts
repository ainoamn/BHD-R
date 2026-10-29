import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { requireSessionSecret } from '@/lib/runtime-env';
import { canOpenSection, portalsForRoles } from '@/lib/portal-access';
import { isOperationsSection } from '@/lib/portal-ops-types';
import { loadOperationsWorkspacePayload } from '@/lib/portal-ops-workspace';
import type { PortalRole } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const PORTALS = new Set<PortalRole>(['owner', 'developer', 'tenant', 'platform']);

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

/**
 * GET /api/portal/ops/:portal/:section
 * Session-backed ops payload for client cache / soft navigation (WAZEN-style).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ portal: string; section: string }> },
) {
  const { portal: portalRaw, section: sectionRaw } = await context.params;
  if (!PORTALS.has(portalRaw as PortalRole) || !isOperationsSection(sectionRaw)) {
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
  if (!allowed.includes(portal) || !canOpenSection(claims, portal, sectionRaw)) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const locale = claims.locale === 'en' ? 'en' : 'ar';
  try {
    const payload = await loadOperationsWorkspacePayload(portal, sectionRaw, claims, locale);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[portal/ops] load failed', portal, sectionRaw, error);
    return NextResponse.json(
      {
        records: [],
        summary: {},
        secondary: [],
        context: {},
        apiOnline: false,
        nestConfigured: true,
        recordsEmpty: false,
        apiUnauthorized: false,
        dataFromDb: false,
        loadError: true,
        locale,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
