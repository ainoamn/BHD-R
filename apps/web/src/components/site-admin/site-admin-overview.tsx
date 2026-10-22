'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { PlatformDiagnostics } from '@/lib/platform-admin-neon';

const LINKS: Array<{ href: string; ar: string; en: string; hintAr: string; hintEn: string }> = [
  {
    href: '/site-admin/diagnostics',
    ar: 'تشخيص النظام',
    en: 'Diagnostics',
    hintAr: 'صحة القاعدة والهوية والطوابير والجلسات',
    hintEn: 'Database, identity, queues, sessions',
  },
  {
    href: '/site-admin/plans',
    ar: 'الباقات والاشتراكات',
    en: 'Plans & subscriptions',
    hintAr: 'أسعار الباقات وحالة اشتراك كل منشأة',
    hintEn: 'Plan prices and each organization’s subscription',
  },
  {
    href: '/site-admin/billing',
    ar: 'إحصائيات الاشتراك',
    en: 'Billing stats',
    hintAr: 'تقدير شهري وحالات السداد',
    hintEn: 'Estimated MRR and payment statuses',
  },
  {
    href: '/site-admin/users',
    ar: 'المستخدمون',
    en: 'Users',
    hintAr: 'إيقاف الحسابات وإعادة تفعيلها',
    hintEn: 'Suspend and restore accounts',
  },
  {
    href: '/site-admin/security',
    ar: 'الأمن والتدقيق',
    en: 'Security',
    hintAr: 'سجل التدقيق وبصمات IP والجلسات',
    hintEn: 'Audit log, IP fingerprints, sessions',
  },
  {
    href: '/site-admin/complaints',
    ar: 'شكاوى التأمين',
    en: 'Deposit complaints',
    hintAr: 'تشغيل يومي لشكاوى الضيوف',
    hintEn: 'Day-to-day guest deposit complaints',
  },
  {
    href: '/site-admin/verification',
    ar: 'توثيق الحسابات',
    en: 'Verification',
    hintAr: 'مراجعة طلبات التوثيق',
    hintEn: 'Review verification requests',
  },
  {
    href: '/site-admin/notifications',
    ar: 'قوالب الإشعارات',
    en: 'Notification templates',
    hintAr: 'رسائل البريد والتنبيهات',
    hintEn: 'Email and alert wording',
  },
  {
    href: '/site-admin/badges',
    ar: 'الشارات',
    en: 'Badges',
    hintAr: 'كتالوج الشارات والاعتماد',
    hintEn: 'Badge catalogue and approvals',
  },
  {
    href: '/site-admin/api-keys',
    ar: 'مفاتيح API',
    en: 'API keys',
    hintAr: 'وصول برمجي للمنشأة النشطة',
    hintEn: 'Programmatic access for the active org',
  },
  {
    href: '/site-admin/lab-reset',
    ar: 'إعادة ضبط التجارب',
    en: 'Lab reset',
    hintAr: 'مسح بيانات التجريب مع الإبقاء على العقارات',
    hintEn: 'Wipe test data while keeping properties',
  },
  {
    href: '/site-admin/delegates',
    ar: 'التفويض',
    en: 'Delegation',
    hintAr: 'مَن يدير الموقع نيابةً عنك',
    hintEn: 'Who may manage the site for you',
  },
];

/** Landing hub for site owners / site managers — never shown inside owner/tenant portals. */
export function SiteAdminOverview({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pulse, setPulse] = useState<PlatformDiagnostics['counts'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/site-admin/diagnostics', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as PlatformDiagnostics;
        if (!cancelled) setPulse(payload.counts);
      } catch {
        /* overview still works without pulse */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="platform-admin-overview site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
      <header className="platform-admin__head">
        <div>
          <p className="platform-admin__kicker">
            {ar ? 'تحكم الموقع والنظام' : 'Site & system control'}
          </p>
          <h1>{ar ? 'لوحة مالك الموقع' : 'Site owner console'}</h1>
          <p>
            {ar
              ? 'هذه المساحة خاصة بمالك الموقع ومديريه فقط — منفصلة تماماً عن بوابات العملاء والملاك والمستأجرين.'
              : 'This space is for the site owner and site managers only — completely separate from customer, owner, and tenant portals.'}
          </p>
        </div>
      </header>

      {pulse ? (
        <div className="platform-admin__cards">
          <article className="platform-admin__card">
            <span>{ar ? 'منشآت' : 'Orgs'}</span>
            <strong dir="ltr">{pulse.organizations}</strong>
          </article>
          <article className="platform-admin__card">
            <span>{ar ? 'مستخدمون' : 'Users'}</span>
            <strong dir="ltr">{pulse.users}</strong>
          </article>
          <article className="platform-admin__card">
            <span>{ar ? 'جلسات' : 'Sessions'}</span>
            <strong dir="ltr">{pulse.activeSessions}</strong>
          </article>
          <article className="platform-admin__card">
            <span>{ar ? 'Outbox' : 'Outbox'}</span>
            <strong dir="ltr">{pulse.openOutbox}</strong>
          </article>
        </div>
      ) : null}

      <div className="platform-admin-overview__grid">
        {LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="platform-admin-overview__tile" prefetch={false}>
            <strong>{ar ? item.ar : item.en}</strong>
            <span>{ar ? item.hintAr : item.hintEn}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
