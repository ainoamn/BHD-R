import { NextResponse } from 'next/server';
import { canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import {
  sendAccountingArtifact,
  type AccountingSendKind,
} from '@/lib/accounting-send-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

/** POST /api/owner/accounting/send — email + WhatsApp deep-link for journals/documents/reports. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      kind?: AccountingSendKind;
      id?: string;
      channel?: 'email' | 'whatsapp' | 'both';
      locale?: 'ar' | 'en';
      email?: string;
      phone?: string;
      reportSummary?: string;
    } | null;
    if (!body?.kind || !body.id) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    if (!['journal', 'document', 'report'].includes(body.kind)) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const result = await sendAccountingArtifact(claims, {
      kind: body.kind,
      id: body.id,
      channel: body.channel ?? 'both',
      locale: body.locale === 'en' ? 'en' : 'ar',
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.reportSummary ? { reportSummary: body.reportSummary } : {}),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/send');
  }
}
