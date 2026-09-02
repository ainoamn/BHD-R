'use client';

import { useEffect, useState } from 'react';
import type { ReviewSummary } from '@/lib/reviews-types';

function toTenScale(avgRating: number | null): string | null {
  if (avgRating == null || !Number.isFinite(avgRating)) return null;
  return (avgRating * 2).toFixed(1);
}

export function PropertyReviewScore({
  propertyId,
  locale,
  variant = 'chip',
}: {
  propertyId: string;
  locale: string;
  variant?: 'chip' | 'headline';
}) {
  const ar = locale === 'ar';
  const [summary, setSummary] = useState<ReviewSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/reviews?targetType=property&targetId=${encodeURIComponent(propertyId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { summary: ReviewSummary };
        if (!cancelled) setSummary(json.summary);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const score = toTenScale(summary?.avgRating ?? null);
  if (!score || !summary?.reviewCount) return null;

  if (variant === 'headline') {
    return (
      <div className="property-review-score property-review-score--headline">
        <span className="property-review-score__value" dir="ltr">
          {score}
        </span>
        <div>
          <strong>{ar ? 'ممتاز' : 'Wonderful'}</strong>
          <span>
            {summary.reviewCount} {ar ? 'تقييم' : 'reviews'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <span className="property-review-score property-review-score--chip" dir="ltr">
      <span className="property-review-score__value">{score}</span>
      <span className="property-review-score__label">{ar ? 'تقييم' : 'Score'}</span>
    </span>
  );
}
