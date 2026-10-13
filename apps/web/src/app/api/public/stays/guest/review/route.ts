import { after } from 'next/server';
import { z } from 'zod';
import { submitGuestReview } from '@/lib/booking-reviews-neon';
import { stayBookingDbGuard, stayBookingJson } from '@/lib/public-stays-booking-route';
import { announceReleasedReviews } from '@/lib/review-release-neon';
import { reviewFields } from '@/lib/review-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z
  .object({ referenceCode: z.string().trim().min(4).max(40), ...reviewFields })
  .strict();

const MESSAGES: Record<string, { status: number; ar: string; en: string }> = {
  booking_not_found: { status: 404, ar: 'الحجز غير موجود.', en: 'Booking not found.' },
  review_not_open: {
    status: 409,
    ar: 'يُتاح التقييم بعد تسجيل المغادرة.',
    en: 'Reviews open after check-out.',
  },
  review_exists: {
    status: 409,
    ar: 'قيّمت هذه الإقامة مسبقاً.',
    en: 'You already reviewed this stay.',
  },
  review_invalid: {
    status: 400,
    ar: 'أكمل تقييم كل البنود المطلوبة.',
    en: 'Rate every required item.',
  },
  review_comment_required: {
    status: 400,
    ar: 'التقييم منخفض: اكتب ملاحظتك بإيجاز ليعرف المالك والضيوف ما حدث.',
    en: 'The score is low: briefly say what went wrong.',
  },
  review_photo_invalid: {
    status: 400,
    ar: 'إحدى الصور غير صالحة أو كبيرة جداً.',
    en: 'One of the photos is invalid or too large.',
  },
};

/** POST /api/public/stays/guest/review — the guest rates the property and its management. */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-guest-review', clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const context = { oidcToken: request.headers.get('x-vercel-oidc-token') };
  try {
    const saved = await submitGuestReview(body.referenceCode, body, context);
    after(() =>
      announceReleasedReviews(context, { bookingId: saved.bookingId }).catch((error: unknown) =>
        console.error('review release', error),
      ),
    );
    return stayBookingJson({
      review: { id: saved.id, score: saved.score, criteriaScore: saved.criteriaScore },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const known = MESSAGES[code];
    if (known) {
      return stayBookingJson(
        { error: { code, messageAr: known.ar, message: known.en } },
        { status: known.status },
      );
    }
    console.error('POST /api/public/stays/guest/review', error);
    return stayBookingJson(
      {
        error: {
          code: 'request_failed',
          messageAr: 'تعذّر حفظ التقييم. أعد المحاولة.',
          message: 'Could not save the review. Try again.',
        },
      },
      { status: 500 },
    );
  }
}
