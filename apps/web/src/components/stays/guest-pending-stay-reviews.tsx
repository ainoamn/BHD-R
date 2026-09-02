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
          ? 'بعد انتهاء الإقامة يظهر طلب التقييم مباشرة — ساعدنا في بناء التقييم الذكي للعقار.'
          : 'Right after checkout, rate your stay — your feedback powers the smart property score.'}
      </p>
      <ul className="stay-reviews-timeline">
        {items.map((item) => {
          const cover = toPublicMediaSrc(item.coverImageUrl);
          const href = item.slug
            ? `/stays/${encodeURIComponent(item.slug)}#stay-reviews-title`
            : `/guest/stays/${item.bookingId}?ref=${encodeURIComponent(item.referenceCode)}`;
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
                {cover ? <Image src={cover} alt="" fill sizes="96px" /> : <BrandMark tone="onDark" />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
