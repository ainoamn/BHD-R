'use client';

import { Link, usePathname } from '@/i18n/navigation';

const TABS: Array<{ path: string; ar: string; en: string }> = [
  { path: '/platform', ar: 'نظرة عامة', en: 'Overview' },
  { path: '/platform/diagnostics', ar: 'تشخيص النظام', en: 'Diagnostics' },
  { path: '/platform/subscriptions', ar: 'الاشتراكات', en: 'Subscriptions' },
  { path: '/platform/billing', ar: 'إحصائيات الاشتراك', en: 'Billing stats' },
  { path: '/platform/users', ar: 'المستخدمون', en: 'Users' },
  { path: '/platform/organizations', ar: 'المنشآت', en: 'Organizations' },
  { path: '/platform/security', ar: 'الأمن والتدقيق', en: 'Security' },
  { path: '/site-admin', ar: 'تشغيل الموقع', en: 'Site ops' },
];

/** Secondary tab row for the platform administration console. */
export function PlatformAdminNav({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const pathname = usePathname();
  return (
    <nav className="platform-admin-nav" aria-label={ar ? 'أقسام إدارة المنصة' : 'Platform admin'}>
      <div className="platform-admin-nav__tabs">
        {TABS.map((tab) => {
          const current =
            tab.path === '/platform'
              ? pathname === '/platform' || pathname === '/platform/'
              : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              prefetch={false}
              className={current ? 'is-current' : undefined}
              aria-current={current ? 'page' : undefined}
            >
              {ar ? tab.ar : tab.en}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
