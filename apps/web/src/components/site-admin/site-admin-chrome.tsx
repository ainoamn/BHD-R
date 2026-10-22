import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import type { SiteAdminAccess } from '@/lib/site-admin-shared';

/** Shared sidebar + main frame for every /admin page. */
export function SiteAdminChrome({
  access,
  locale,
  children,
}: {
  access: SiteAdminAccess;
  locale: 'ar' | 'en';
  children: React.ReactNode;
}) {
  return (
    <div className="site-admin-frame">
      <SiteAdminNav access={access} locale={locale} />
      <div className="site-admin-main">{children}</div>
    </div>
  );
}
