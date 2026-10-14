import Link from 'next/link';
import { IdentityAvatar, VerifiedMark } from '@/components/identity/verified-mark';
import { StayRatingBadge } from '@/components/stays/stay-rating-badge';
import type { HostSummary } from '@/lib/booking-reviews-neon';

export function hostRoleLabel(type: HostSummary['type'], ar: boolean): string {
  if (type === 'company') return ar ? 'شركة إدارة عقارات' : 'Property management company';
  if (type === 'developer') return ar ? 'مطوّر عقاري' : 'Property developer';
  return ar ? 'المالك' : 'Owner';
}

export function countLabelAr(count: number, one: string, two: string, few: string, many: string) {
  if (count === 1) return one;
  if (count === 2) return two;
  if (count >= 3 && count <= 10) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function hostStockLabel(host: Pick<HostSummary, 'properties' | 'units'>, ar: boolean) {
  if (!ar) {
    return `${host.properties} propert${host.properties === 1 ? 'y' : 'ies'} · ${host.units} unit${host.units === 1 ? '' : 's'}`;
  }
  return `${countLabelAr(host.properties, 'عقار واحد', 'عقاران', 'عقارات', 'عقاراً')} · ${countLabelAr(host.units, 'وحدة واحدة', 'وحدتان', 'وحدات', 'وحدة')}`;
}

export function memberSinceLabel(iso: string, ar: boolean): string {
  const month = new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
  return ar ? `على BHD R منذ ${month}` : `On BHD R since ${month}`;
}

/** Who owns or manages the listing, with the guests' rating of them; opens their public profile. */
export function HostCard({
  host,
  locale,
  ownerName = null,
}: {
  host: HostSummary;
  locale: 'ar' | 'en';
  /** The legal owner's name, only when the owner chose to show it on listings. */
  ownerName?: string | null;
}) {
  const ar = locale === 'ar';
  const name = ar ? host.name.ar : host.name.en;
  const showOwner = ownerName && ownerName.trim() !== name.trim();
  return (
    <Link className="host-card" href={`/${locale}/profiles/hosts/${host.id}`}>
      {host.mark?.avatarUrl ? (
        <IdentityAvatar
          name={name}
          mark={host.mark}
          locale={locale}
          size={52}
          className="host-card__avatar"
          business
        />
      ) : (
        <span className="host-card__avatar" aria-hidden="true">
          {name.trim().charAt(0) || '؟'}
        </span>
      )}
      <span className="host-card__body">
        <span className="host-card__eyebrow">
          {ar ? 'يملك هذا العقار أو يديره' : 'Owned or managed by'} ·{' '}
          <span className={`host-card__role host-card__role--${host.type}`}>
            {hostRoleLabel(host.type, ar)}
          </span>
        </span>
        <strong className="host-card__name name-with-mark">
          <bdi>{name}</bdi>
          <VerifiedMark verified={host.mark?.verified} locale={locale} business />
        </strong>
        {showOwner ? (
          <span className="host-card__owner">
            {ar ? 'المالك: ' : 'Owner: '}
            <bdi>{ownerName}</bdi>
          </span>
        ) : null}
        <span className="host-card__meta">
          {hostStockLabel(host, ar)} · {memberSinceLabel(host.memberSince, ar)}
        </span>
      </span>
      <span className="host-card__side">
        <StayRatingBadge
          rating={host.score !== null ? { score: host.score, count: host.reviews } : null}
          ar={ar}
          compact
          as="span"
        />
        <span className="host-card__cta">
          {ar ? 'الملف وكل العقارات ←' : 'Profile and all properties →'}
        </span>
      </span>
    </Link>
  );
}
