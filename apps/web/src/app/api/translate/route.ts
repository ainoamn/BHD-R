import { NextResponse } from 'next/server';
import { machineTranslate } from '@/lib/machine-translate';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = {
  text?: string;
  target?: 'ar' | 'en';
};

export async function POST(request: Request) {
  let claims;
  try {
    // Session + same-origin is enough for this low-risk helper; CSRF double-submit
    // was racing Nest cookie overwrites and blocking legitimate owner edits.
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['translate', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = body.text?.trim() ?? '';
  const target = body.target;
  if (!text || (target !== 'ar' && target !== 'en')) {
    return NextResponse.json({ error: 'text and target (ar|en) required' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: 'text too long' }, { status: 400 });
  }

  const translated = await machineTranslate(text, target);
  if (!translated) {
    return NextResponse.json(
      {
        error: 'translate_failed',
        message: 'Translation provider unavailable',
        messageAr: 'تعذّرت الترجمة حالياً',
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ translated });
}
