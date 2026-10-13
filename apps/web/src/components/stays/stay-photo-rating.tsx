'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReputationView } from '@/components/reviews/reputation-view';
import { StayRatingBadge } from '@/components/stays/stay-rating-badge';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';

/** Guest score on the stay's main photo; opens every review and comment of the unit in a dialog. */
export function StayPhotoRating({
  unitId,
  rating,
  locale,
  hostKey = null,
}: {
  unitId: string;
  rating: StayCatalogueListing['rating'];
  locale: 'ar' | 'en';
  hostKey?: string | null;
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="stay-photo-rating"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={ar ? 'عرض التقييمات والتعليقات' : 'See reviews and comments'}
      >
        <StayRatingBadge rating={rating} ar={ar} as="span" />
        {rating ? (
          <span className="stay-photo-rating__more" aria-hidden="true">
            {ar ? 'كل التعليقات ←' : 'All comments →'}
          </span>
        ) : null}
      </button>

      {open
        ? createPortal(
            <div
              className="stay-reviews-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="stay-reviews-dialog-title"
            >
              <button
                type="button"
                className="stay-reviews-dialog__backdrop"
                aria-label={ar ? 'إغلاق' : 'Close'}
                tabIndex={-1}
                onClick={() => setOpen(false)}
              />
              <div className="stay-reviews-dialog__card">
                <button
                  ref={closeRef}
                  type="button"
                  className="stay-reviews-dialog__close"
                  onClick={() => setOpen(false)}
                  aria-label={ar ? 'إغلاق' : 'Close'}
                >
                  ×
                </button>
                <ReputationView
                  subject="unit"
                  subjectKey={unitId}
                  locale={locale}
                  hostKey={hostKey}
                  showAllReviews
                  titleId="stay-reviews-dialog-title"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
