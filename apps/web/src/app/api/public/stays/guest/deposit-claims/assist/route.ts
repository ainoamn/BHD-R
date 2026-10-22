import { z } from 'zod';
import { NOTE_TRANSLATE_MAX, noteLanguage, otherLanguage } from '@/lib/note-translation';
import { assistNote, translateNote } from '@/lib/note-translate-ai';
import { stayBookingDbGuard, stayBookingJson } from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { assertGuestStayReference } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const referenceCode = z.string().trim().min(4).max(40);

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('assist'),
      referenceCode,
      text: z.string().trim().min(2).max(NOTE_TRANSLATE_MAX),
    })
    .strict(),
  z
    .object({
      action: z.literal('translate'),
      referenceCode,
      text: z.string().trim().min(1).max(NOTE_TRANSLATE_MAX),
      target: z.enum(['ar', 'en']),
    })
    .strict(),
]);

/**
 * POST writing help for guest deposit requests, complaints and appeals:
 * live translation, spelling/grammar fix, and clearer wording.
 */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-guest-claim-assist', clientIp(request), body.referenceCode]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return stayBookingJson(
      {
        error: {
          code: 'rate_limited',
          messageAr: 'طلبات كثيرة خلال دقيقة — انتظر قليلاً.',
          message: 'Too many requests in a minute — wait a moment.',
        },
      },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const context = { oidcToken: request.headers.get('x-vercel-oidc-token') };
  try {
    await assertGuestStayReference(body.referenceCode);
    if (body.action === 'translate') {
      return stayBookingJson(await translateNote(context, body));
    }
    const source = noteLanguage(body.text);
    const target = otherLanguage(source);
    const result = await assistNote(context, { text: body.text, source, target });
    return stayBookingJson({ ...result, source, target });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'booking_not_found') {
      return stayBookingJson(
        {
          error: {
            code,
            messageAr: 'الحجز غير موجود.',
            message: 'Booking not found.',
          },
        },
        { status: 404 },
      );
    }
    if (code === 'ai_failed' || code === 'ai_unconfigured') {
      return stayBookingJson(
        {
          error: {
            code,
            messageAr: 'تعذّر المساعد الذكي الآن، أعد المحاولة بعد قليل.',
            message: 'The writing assistant is unavailable right now; try again shortly.',
          },
        },
        { status: 502 },
      );
    }
    console.error('POST /api/public/stays/guest/deposit-claims/assist', error);
    return stayBookingJson(
      {
        error: {
          code: 'request_failed',
          messageAr: 'تعذّر إكمال الطلب. أعد المحاولة.',
          message: 'Could not complete the request. Try again.',
        },
      },
      { status: 500 },
    );
  }
}
