'use client';

import { useEffect, useState } from 'react';
import { reviewScoreLabel, reviewScoreTone, type Reputation } from '@/lib/review-rubric';

export function PropertyReviewScore({
  propertyId,
  unitId,
  locale,
  variant = 'chip',
}: {
  propertyId: string;
  /** Rate this unit of a building on its own instead of the whole property. */
  unitId?: string | undefined;
  locale: string;
  variant?: 'chip' | 'headline';
}) {
  const ar = locale === 'ar';
  const [summary, setSummary] = useState<{ score: number; count: number } | null>(null);
  const subject = unitId ? 'unit' : 'property';
  const subjectKey = unitId ?? propertyId;

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/reputation?subject=${subject}&key=${encodeURIComponent(subjectKey)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { reputation?: Reputation };
        const score = json.reputation?.score ?? null;
        if (!cancelled && score !== null && json.reputation?.count) {
          setSummary({ score, count: json.reputation.count });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject, subjectKey]);

  if (!summary) return null;
  const score = summary.score.toFixed(1);

  if (variant === 'headline') {
    return (
      <div className="property-review-score property-review-score--headline">
        <span className="property-review-score__value" dir="ltr">
          {score}
        </span>
        <div>
          <strong>{reviewScoreLabel(summary.score, ar)}</strong>
          <span>
            {summary.count} {ar ? 'تقييم' : 'reviews'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <a
      className={`property-review-score property-review-score--chip property-review-score--${reviewScoreTone(summary.score)}`}
      href={unitId ? '#reputation-unit-title' : '#property-reviews'}
      dir="ltr"
      title={`${reviewScoreLabel(summary.score, ar)} · ${summary.count} ${ar ? 'تقييم' : 'reviews'}`}
    >
      <span className="property-review-score__value">{score}</span>
      <span className="property-review-score__label">
        {reviewScoreLabel(summary.score, ar)} · {summary.count}
      </span>
    </a>
  );
}
