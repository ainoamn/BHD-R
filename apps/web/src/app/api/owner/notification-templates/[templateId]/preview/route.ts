import { NextResponse } from 'next/server';
import type { SessionClaims } from '@bhd-r/authz';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { renderBrandedEmail } from '@/lib/email-template';
import { getNotificationTemplate } from '@/lib/notification-templates-catalog';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { publicWebOrigin } from '@/lib/seo';
import { renderWhatsAppMessage } from '@/lib/whatsapp-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — live HTML / text / WhatsApp sample for one template. */
export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
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
  const { templateId } = await context.params;
  const template = getNotificationTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    try {
      const { hydrateEmailWishPools } = await import('@/lib/email-wish-pools-neon');
      await hydrateEmailWishPools();
    } catch {
      /* preview still works with built-in wishes */
    }
    const origin = publicWebOrigin();
    const rotate = new URL(request.url).searchParams.get('rotate')?.trim() || '0';
    const seed = `preview:${template.id}:${rotate}`;
    const email = template.email
      ? {
          subject: template.email.subject,
          ...renderBrandedEmail(template.email, { origin, seed }),
        }
      : null;
    const whatsapp = template.whatsapp ? renderWhatsAppMessage(template.whatsapp, { seed }) : null;
    return NextResponse.json(
      {
        id: template.id,
        channel: template.channel,
        email,
        whatsapp,
        wishSeed: rotate,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
