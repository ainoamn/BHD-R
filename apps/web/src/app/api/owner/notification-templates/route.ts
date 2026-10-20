import { NextResponse } from 'next/server';
import type { SessionClaims } from '@bhd-r/authz';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { listNotificationTemplates } from '@/lib/notification-templates-catalog';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — catalog of email / WhatsApp notification templates (preview metadata). */
export async function GET(request: Request) {
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  try {
    return NextResponse.json(
      { templates: listNotificationTemplates() },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
