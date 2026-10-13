'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StayReviewPending } from '@/lib/stay-reviews-types';

/** Booking.com-style pending review invitations on My trips. */
export function GuestPendingStayReviews({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  const [items, setItems] = useState<StayReviewPending[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/public/stays/reviews/pending', {
          credentials: 'same-origin',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: StayReviewPending[] };
        if (!cancelled) setItems(json.data ?? []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items.length) return null;

  return (
    <section className="guest-pending-reviews" aria-labelledby="guest-pending-reviews-title">
      <h2 id="guest-pending-reviews-title">{ar ? 'قيّم إقاماتك' : 'Rate your stays'}</h2>
      <p className="muted">
        {ar
          ? 'بعد مغادرتك يظهر طلب التقييم هنا. يُنشر تقييمك في صفحة الإقامة بعد تسوية مبلغ التأمين.'
          : 'After you check out, rate your stay here. Your review is published on the stay page once the deposit is settled.'}
      </p>
      <ul className="stay-reviews-timeline">
        {items.map((item) => {
          const cover = toPublicMediaSrc(item.coverImageUrl);
          const href = `/guest/stays/${item.bookingId}?ref=${encodeURIComponent(item.referenceCode)}#stay-review`;
          return (
            <li key={item.bookingId} className="stay-review-card stay-review-card--pending">
              <div className="stay-review-card__body">
                <p className="stay-review-card__title">
                  {ar
                    ? `ما زال بإمكانك تقييم إقامتك في ${item.titleAr}`
                    : `You can still rate your stay at ${item.titleEn}`}
                </p>
                <p className="muted">
                  {ar
                    ? `يتبقى لديك ${item.daysLeft} يوماً`
                    : `You only have ${item.daysLeft} days left`}
                </p>
                <Link className="button button--primary" href={href}>
                  {ar ? 'قيّم إقامتك' : 'Rate your stay'}
                </Link>
              </div>
              <div className="stay-review-card__thumb">
                {cover ? (
                  <Image src={cover} alt="" fill sizes="96px" />
                ) : (
                  <BrandMark tone="onDark" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
