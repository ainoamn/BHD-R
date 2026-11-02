'use client';

import { SiteAdminMainSlot } from '@/components/site-admin/site-admin-main-slot';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import type { SiteAdminAccess } from '@/lib/site-admin-shared';
import type { Viewer } from '@/lib/types';

/** Full-bleed sidebar + soft-nav main frame for every /admin page. */
export function SiteAdminChrome({
  access,
  locale,
  viewer,
  children,
}: {
  access: SiteAdminAccess;
  locale: 'ar' | 'en';
  viewer: Viewer;
  children: React.ReactNode;
}) {
  return (
    <div className="site-admin-frame">
      <SiteAdminNav access={access} locale={locale} viewer={viewer} />
      <div className="site-admin-main">
        <SiteAdminMainSlot access={access} locale={locale}>
          {children}
        </SiteAdminMainSlot>
      </div>
    </div>
  );
}
