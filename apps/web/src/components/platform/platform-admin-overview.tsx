'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { PlatformDiagnostics } from '@/lib/platform-admin-neon';

const LINKS: Array<{ href: string; ar: string; en: string; hintAr: string; hintEn: string }> = [
  {
    href: '/platform/diagnostics',
    ar: 'تشخيص النظام',
    en: 'Diagnostics',
    hintAr: 'صحة القاعدة والهوية والطوابير والجلسات',
    hintEn: 'Database, identity, queues, sessions',
  },
  {
    href: '/platform/subscriptions',
    ar: 'الباقات والاشتراكات',
    en: 'Plans & subscriptions',
    hintAr: 'أسعار الباقات وحالة اشتراك كل منشأة',
    hintEn: 'Plan prices and each organization’s subscription',
  },
  {
    href: '/platform/billing',
    ar: 'إحصائيات الاشتراك',
    en: 'Billing stats',
    hintAr: 'تقدير شهري وحالات السداد',
    hintEn: 'Estimated MRR and payment statuses',
  },
  {
    href: '/platform/users',
    ar: 'المستخدمون',
    en: 'Users',
    hintAr: 'إيقاف الحسابات وإعادة تفعيلها',
    hintEn: 'Suspend and restore accounts',
  },
  {
    href: '/platform/security',
    ar: 'الأمن والتدقيق',
    en: 'Security',
    hintAr: 'سجل التدقيق وبصمات IP والجلسات',
    hintEn: 'Audit log, IP fingerprints, sessions',
  },
  {
    href: '/site-admin',
    ar: 'تشغيل الموقع',
    en: 'Site operations',
    hintAr: 'شكاوى التأمين، التوثيق، التفويض',
    hintEn: 'Deposit complaints, verification, delegates',
  },
];

/** Landing hub for platform administration. */
export function PlatformAdminOverview({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pulse, setPulse] = useState<PlatformDiagnostics['counts'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/platform/diagnostics', {
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
    <div className="platform-admin-overview">
      <header className="platform-admin__head">
        <div>
          <p className="platform-admin__kicker">{ar ? 'إدارة المنصة' : 'Platform admin'}</p>
          <h1>{ar ? 'لوحة تحكم المشرف' : 'Administrator console'}</h1>
          <p>
            {ar
              ? 'تشخيص النظام، الاشتراكات والمستخدمون، إحصائيات التحصيل التقديرية، ومتابعة الأمن والتدقيق — في مكان واحد.'
              : 'System diagnostics, subscriptions and users, estimated billing stats, and security audit — in one place.'}
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
