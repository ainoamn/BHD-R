import 'server-only';
import { claimReleasedReviews, refreshReviewProfile } from '@/lib/booking-reviews-neon';
import { notifyGuestOfHostReview } from '@/lib/stay-deposit-claims-neon';

/**
 * Announces each review once it is released: the guest receives the host's review by email,
 * and the reviewed profiles are summarised again. Runs after the actions that can release a
 * review, and daily for releases that come with time (receipt assumed, 14 days passed).
 */
export async function announceReleasedReviews(
  context: { oidcToken: string | null },
  scope: { bookingId?: string; referenceCode?: string; limit?: number } = {},
): Promise<number> {
  const released = await claimReleasedReviews(scope);
  for (const review of released) {
    if (review.direction === 'host_to_guest') {
      await notifyGuestOfHostReview(review.bookingId, {
        score: review.score,
        summary: review.summaryAr,
      }).catch((error: unknown) => console.error('host review guest notice', error));
    }
    for (const [subject, key] of review.subjects) {
      await refreshReviewProfile(subject, key, context).catch((error: unknown) =>
        console.error('review profile refresh', subject, error),
      );
    }
  }
  return released.length;
}
