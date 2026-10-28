'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { PlatformDiagnostics } from '@/lib/platform-admin-neon';

const LINKS: Array<{ href: string; ar: string; en: string; hintAr: string; hintEn: string }> = [
  {
    href: '/admin/diagnostics',
    ar: 'تشخيص النظام',
    en: 'Diagnostics',
    hintAr: 'صحة القاعدة والهوية والطوابير والجلسات',
    hintEn: 'Database, identity, queues, sessions',
  },
  {
    href: '/admin/plans',
    ar: 'الباقات والاشتراكات',
    en: 'Plans & subscriptions',
    hintAr: 'أسعار الباقات وحالة اشتراك كل منشأة',
    hintEn: 'Plan prices and each organization’s subscription',
  },
  {
    href: '/admin/billing',
    ar: 'إحصائيات الاشتراك',
    en: 'Billing stats',
    hintAr: 'تقدير شهري وحالات السداد',
    hintEn: 'Estimated MRR and payment statuses',
  },
  {
    href: '/admin/users',
    ar: 'المستخدمون',
    en: 'Users',
    hintAr: 'إيقاف الحسابات وإعادة تفعيلها',
    hintEn: 'Suspend and restore accounts',
  },
  {
    href: '/admin/security',
    ar: 'الأمن والتدقيق',
    en: 'Security',
    hintAr: 'سجل التدقيق وبصمات IP والجلسات',
    hintEn: 'Audit log, IP fingerprints, sessions',
  },
  {
    href: '/admin/complaints',
    ar: 'تشغيل الموقع',
    en: 'Site operations',
    hintAr: 'شكاوى التأمين، التوثيق، التفويض',
    hintEn: 'Deposit complaints, verification, delegates',
  },
];

/** Legacy hub — prefer SiteAdminOverview under /admin. */
export function PlatformAdminOverview({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pulse, setPulse] = useState<PlatformDiagnostics['counts'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/site-admin/diagnostics', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const data = (await response.json()) as PlatformDiagnostics;
        if (!cancelled) setPulse(data.counts);
      } catch {
        /* ignore */
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
          <p className="platform-admin__kicker">{ar ? 'تحكم الموقع' : 'Site control'}</p>
          <h1>{ar ? 'انتقل إلى /admin' : 'Use /admin'}</h1>
          <p>
            {ar
              ? 'أدوات النظام لم تعد جزءاً من بوابة /platform.'
              : 'System tools are no longer part of the /platform portal.'}
          </p>
        </div>
        <Link className="button" href="/admin" prefetch={false}>
          {ar ? 'فتح تحكم الموقع' : 'Open site console'}
        </Link>
      </header>
      {pulse ? (
        <div className="platform-admin__cards">
          <article className="platform-admin__card">
            <strong>{pulse.organizations}</strong>
            <span>{ar ? 'منشآت' : 'Orgs'}</span>
          </article>
          <article className="platform-admin__card">
            <strong>{pulse.users}</strong>
            <span>{ar ? 'مستخدمون' : 'Users'}</span>
          </article>
          <article className="platform-admin__card">
            <strong>{pulse.activeSessions}</strong>
            <span>{ar ? 'جلسات' : 'Sessions'}</span>
          </article>
          <article className="platform-admin__card">
            <strong>{pulse.openOutbox}</strong>
            <span>{ar ? 'طابور' : 'Outbox'}</span>
          </article>
        </div>
      ) : null}
      <div className="platform-admin-overview__grid">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="platform-admin-overview__tile"
            prefetch={false}
          >
            <strong>{ar ? item.ar : item.en}</strong>
            <span>{ar ? item.hintAr : item.hintEn}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
