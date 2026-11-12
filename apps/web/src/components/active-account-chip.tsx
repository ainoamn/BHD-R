'use client';

import dynamic from 'next/dynamic';
import type { Viewer } from '@/lib/types';
import { useTabAccountFace } from '@/lib/identity/use-tab-account-face';

const BhdAppSwitcher = dynamic(
  () => import('@/components/bhd-app-switcher').then((mod) => mod.BhdAppSwitcher),
  { ssr: false },
);

/**
 * Always-visible tab account. Label comes from the same face as the switcher
 * (live session after ?au= reconcile) so outside and inside never disagree.
 */
export function ActiveAccountChip({
  viewer,
  locale,
  compact = false,
  className,
}: {
  viewer: Viewer;
  locale: 'ar' | 'en';
  compact?: boolean;
  className?: string;
}) {
  const ar = locale === 'ar';
  const face = useTabAccountFace({
    email: viewer.email,
    name: viewer.displayName,
  });
  const email = face.email || viewer.email?.trim() || '';
  const name = face.name || viewer.displayName?.trim() || '';
  const primary = email || name || (ar ? 'حسابي' : 'Account');
  const showName = Boolean(name && email && name.toLowerCase() !== email.toLowerCase());
  const title = showName ? `${name} · ${email}` : primary;

  return (
    <div
      className={['active-account-chip', compact ? 'active-account-chip--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      <span className="active-account-chip__text">
        {showName && !compact ? (
          <>
            <strong className="active-account-chip__name">{name}</strong>
            <span className="active-account-chip__email" dir="ltr">
              {email}
            </span>
          </>
        ) : (
          <span className="active-account-chip__email" dir="ltr">
            {compact && email.includes('@') ? `${email.slice(0, email.indexOf('@') + 1)}…` : primary}
          </span>
        )}
      </span>
      <BhdAppSwitcher viewer={viewer} locale={locale} />
    </div>
  );
}
