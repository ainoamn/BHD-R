import { z } from 'zod';
import { assertGuestReviewOpen } from '@/lib/booking-reviews-neon';
import { NOTE_TRANSLATE_MAX, noteLanguage, otherLanguage } from '@/lib/note-translation';
import { assistNote, translateNote } from '@/lib/note-translate-ai';
import { stayBookingDbGuard, stayBookingJson } from '@/lib/public-stays-booking-route';
import { draftReviewSummary } from '@/lib/review-ai';
import { reviewFields } from '@/lib/review-route';
import { REVIEW_COMMENT_MAX, reviewTags, scoreAnswers } from '@/lib/review-rubric';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const referenceCode = z.string().trim().min(4).max(40);

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('summarize'),
      referenceCode,
      answers: reviewFields.answers,
      tags: reviewFields.tags,
      recommend: reviewFields.recommend,
      comment: z.string().max(REVIEW_COMMENT_MAX).optional(),
      lang: z.enum(['ar', 'en']),
    })
    .strict(),
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
  ai_failed: {
    status: 502,
    ar: 'تعذّر المساعد الذكي الآن، أعد المحاولة بعد قليل.',
    en: 'The writing assistant is unavailable right now; try again shortly.',
  },
};

/**
 * POST writing help for the guest's review comment, while the review is still open:
 * `summarize` drafts an editable comment from the ratings, tags and notes; `assist` and
 * `translate` give the live translation, correction and rewording of the comment.
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
    key: hashRateKey(['stay-guest-review-assist', clientIp(request), body.referenceCode]),
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
    await assertGuestReviewOpen(body.referenceCode);
    if (body.action === 'summarize') {
      const draft = await draftReviewSummary(context, {
        answers: body.answers,
        scores: scoreAnswers('guest_to_host', body.answers),
        tags: reviewTags('guest_to_host', body.tags),
        comment: body.comment?.trim() || null,
        recommend: typeof body.recommend === 'boolean' ? body.recommend : null,
        lang: body.lang,
      });
      return stayBookingJson(draft);
    }
    if (body.action === 'translate') {
      return stayBookingJson(await translateNote(context, body));
    }
    const source = noteLanguage(body.text);
    const target = otherLanguage(source);
    const result = await assistNote(context, { text: body.text, source, target });
    return stayBookingJson({ ...result, source, target });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const known = MESSAGES[code];
    if (known) {
      return stayBookingJson(
        { error: { code, messageAr: known.ar, message: known.en } },
        { status: known.status },
      );
    }
    console.error('POST /api/public/stays/guest/review/assist', error);
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
