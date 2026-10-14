import type { IdentityMark } from '@/lib/identity-shared';

/** The verified tick shown right after a name: the account's identity was checked by BHD. */
export function VerifiedMark({
  verified,
  locale,
  size = 16,
  business = false,
}: {
  verified: boolean | undefined;
  locale: 'ar' | 'en';
  size?: number;
  business?: boolean;
}) {
  if (!verified) return null;
  const ar = locale === 'ar';
  const label = business
    ? ar
      ? 'منشأة موثّقة'
      : 'Verified business'
    : ar
      ? 'حساب موثّق'
      : 'Verified account';
  return (
    <span className="verified-mark" title={label} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.5-.6 2.9 1.3 2.7-2.2 2 .1 3-2.9.7-1.6 2.5-2.8-1-2.8 1-1.6-2.5-2.9-.7.1-3-2.2-2 1.3-2.7-.6-2.9 2.6-1.5 1-2.8 3 .2z"
        />
        <path
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.6 12.3l3 3 5.8-6.2"
        />
      </svg>
    </span>
  );
}

/** A picture (or the first letter) for a person or business, with the tick on its corner. */
export function IdentityAvatar({
  name,
  mark,
  locale,
  size = 40,
  className,
  business = false,
}: {
  name: string;
  mark?: IdentityMark | null | undefined;
  locale: 'ar' | 'en';
  size?: number;
  className?: string;
  business?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '؟';
  return (
    <span
      className={`identity-avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {mark?.avatarUrl ? (
        <img src={mark.avatarUrl} alt="" width={size} height={size} loading="lazy" />
      ) : (
        <span className="identity-avatar__initial">{initial}</span>
      )}
      {mark?.verified ? (
        <span className="identity-avatar__tick">
          <VerifiedMark
            verified
            locale={locale}
            size={Math.max(12, Math.round(size * 0.36))}
            business={business}
          />
        </span>
      ) : null}
    </span>
  );
}
