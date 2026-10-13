import { reviewScoreLabel, reviewScoreTone } from '@/lib/review-rubric';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';

export function reviewCountLabel(count: number, ar: boolean): string {
  if (!ar) return count === 1 ? '1 review' : `${count} reviews`;
  if (count === 1) return 'تقييم واحد';
  if (count === 2) return 'تقييمان';
  if (count <= 10) return `${count} تقييمات`;
  return `${count} تقييماً`;
}

/** Guest score on 10 with its word and review count, or a quiet «new» mark before any review. */
export function StayRatingBadge({
  rating,
  ar,
  compact = false,
  className,
  as: Tag = 'p',
}: {
  rating: StayCatalogueListing['rating'];
  ar: boolean;
  compact?: boolean;
  className?: string;
  /** `span` inside buttons and links, where a paragraph is not allowed. */
  as?: 'p' | 'span';
}) {
  const classes = ['stay-rating', compact ? 'stay-rating--compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  if (!rating) {
    return (
      <Tag className={`${classes} stay-rating--new`}>
        <span className="stay-rating__score stay-rating__score--new" aria-hidden="true">
          ★
        </span>
        <span className="stay-rating__count">
          {compact ? (ar ? 'جديد' : 'New') : ar ? 'جديد · لا تقييمات بعد' : 'New · no reviews yet'}
        </span>
      </Tag>
    );
  }
  const score = rating.score.toFixed(1);
  const count = reviewCountLabel(rating.count, ar);
  return (
    <Tag
      className={classes}
      aria-label={ar ? `التقييم ${score} من 10، ${count}` : `Rated ${score} out of 10, ${count}`}
    >
      <span
        className={`stay-rating__score stay-rating__score--${reviewScoreTone(rating.score)}`}
        dir="ltr"
      >
        {score}
      </span>
      <span className="stay-rating__text">
        <strong>{reviewScoreLabel(rating.score, ar)}</strong>
        <span className="stay-rating__count">{count}</span>
      </span>
    </Tag>
  );
}
