'use client';

import { Link } from '@/i18n/navigation';
import { usePathname } from '@/i18n/navigation';

const TABS = [
  { path: '/admin', ar: 'نظرة عامة', en: 'Overview' },
  { path: '/admin/diagnostics', ar: 'تشخيص النظام', en: 'Diagnostics' },
  { path: '/admin/plans', ar: 'الاشتراكات', en: 'Subscriptions' },
  { path: '/admin/billing', ar: 'إحصائيات الاشتراك', en: 'Billing' },
  { path: '/admin/users', ar: 'المستخدمون', en: 'Users' },
  { path: '/admin/security', ar: 'الأمن والتدقيق', en: 'Security' },
] as const;

/** Legacy nav — prefer SiteAdminNav under /admin. */
export function PlatformAdminNav({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const pathname = usePathname();

  return (
    <nav className="platform-admin-nav" aria-label={ar ? 'تحكم الموقع' : 'Site control'}>
      <div className="platform-admin-nav__tabs">
        {TABS.map((tab) => {
          const active =
            tab.path === '/admin'
              ? pathname === '/admin'
              : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              className={active ? 'is-active' : undefined}
              prefetch={false}
            >
              {ar ? tab.ar : tab.en}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
