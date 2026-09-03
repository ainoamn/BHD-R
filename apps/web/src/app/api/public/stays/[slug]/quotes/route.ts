import { createStayQuoteSchema } from '@bhd-r/contracts';
import { createPublicStayQuoteOnNeon } from '@/lib/public-stays-booking-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-quote', clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { slug } = await context.params;
  const url = new URL(request.url);
  const unitFromQuery =
    url.searchParams.get('unitId')?.trim() || url.searchParams.get('unit')?.trim() || undefined;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const parsed = createStayQuoteSchema.safeParse(
    body && typeof body === 'object' && !Array.isArray(body)
      ? {
          ...(body as Record<string, unknown>),
          ...(!('unitId' in (body as object)) && unitFromQuery ? { unitId: unitFromQuery } : {}),
        }
      : body,
  );
  if (!parsed.success) {
    return stayBookingJson(
      {
        error: {
          code: 'invalid_body',
          message: 'Invalid quote request',
          messageAr: 'بيانات الحجز غير مكتملة — تحقق من التواريخ ونوع الإقامة.',
        },
      },
      { status: 400 },
    );
  }

  try {
    const payload = await createPublicStayQuoteOnNeon(slug, parsed.data);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
