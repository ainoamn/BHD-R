'use client';

import { useEffect, useState } from 'react';
import { TenantSpaceContent } from '@/components/tenant-space';
import { useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { EMPTY_TENANCY } from '@/lib/tenancy-shared';
import { tenantSoftViewFromPath } from '@/lib/tenant-soft-nav';
import {
  getTenantSpaceCache,
  warmTenantSpace,
  type TenantSpacePayload,
} from '@/lib/tenant-space-client-cache';

/**
 * One mounted host for all soft tenant section views. Data loads once into the
 * client cache; path changes only swap the visible view (no remount flash).
 */
export function TenantSpaceHost({
  locale,
  active,
}: {
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const pathname = useSoftPortalPathname();
  const view = tenantSoftViewFromPath(pathname) ?? 'overview';
  const [payload, setPayload] = useState<TenantSpacePayload | null>(() => getTenantSpaceCache());

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void warmTenantSpace().then((next) => {
      if (!cancelled && next) setPayload(next);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  if (!payload) {
    return (
      <div className="dash-shell tenant-space" aria-busy="true">
        <p className="muted" role="status">
          {locale === 'ar' ? 'جارٍ تحميل مساحة المستأجر…' : 'Loading tenant space…'}
        </p>
      </div>
    );
  }

  return (
    <TenantSpaceContent
      locale={locale}
      view={view}
      data={payload.data ?? EMPTY_TENANCY}
      failed={payload.failed}
      badges={payload.badges}
      displayName={payload.displayName}
      ownerPortal={payload.ownerPortal}
    />
  );
}
