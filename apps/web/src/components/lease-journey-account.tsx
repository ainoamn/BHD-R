'use client';

import type { Viewer } from '@/lib/types';
import { ActiveAccountChip } from '@/components/active-account-chip';

/**
 * Booking journey pages hide the site header — compact account control for this tab's ?au=.
 */
export function LeaseJourneyAccount({
  viewer,
  locale,
}: {
  viewer: Viewer;
  locale: 'ar' | 'en';
}) {
  return (
    <ActiveAccountChip
      viewer={viewer}
      locale={locale}
      compact
      className="guest-stay-detail__account"
    />
  );
}
