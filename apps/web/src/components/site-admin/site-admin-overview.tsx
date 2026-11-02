'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { pushSoftPortalUrl } from '@/lib/soft-portal-nav';
import type { PlatformDiagnostics } from '@/lib/platform-admin-neon';
import {
  SITE_CONSOLE_NAV_GROUPS,
  SITE_CONSOLE_SECTIONS,
  type SiteConsoleNavGroup,
} from '@/lib/site-admin-shared';

const GROUP_ORDER = (
  Object.entries(SITE_CONSOLE_NAV_GROUPS) as Array<
    [SiteConsoleNavGroup, (typeof SITE_CONSOLE_NAV_GROUPS)[SiteConsoleNavGroup]]
  >
)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([id]) => id)
  .filter((id) => id !== 'home');

/** Landing hub for site owners / site managers — never shown inside owner/tenant portals. */
export function SiteAdminOverview({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pulse, setPulse] = useState<PlatformDiagnostics['counts'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { adminGet } = await import('@/components/site-admin/admin-fetch');
        const payload = await adminGet<PlatformDiagnostics>('/api/site-admin/diagnostics');
        if (!cancelled) setPulse(payload.counts);
      } catch {
        /* overview still works without pulse */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: SITE_CONSOLE_NAV_GROUPS[group],
        items: SITE_CONSOLE_SECTIONS.filter(
          (section) => section.group === group && section.id !== 'overview',
        ),
      })).filter((entry) => entry.items.length > 0),
    [],
  );

  return (
    <div className="sa-hub site-admin--wide">
      <header className="sa-hub__hero">
        <div className="sa-hub__hero-copy">
          <p className="sa-hub__brand">
            <span className="sa-hub__mark" aria-hidden="true" />
            BHD R · {ar ? 'تحكم الموقع' : 'Site console'}
          </p>
          <h1>{ar ? 'لوحة مالك الموقع' : 'Site owner console'}</h1>
          <p className="sa-hub__lead">
            {ar
              ? 'مساحة واحدة لإدارة التشغيل والأمن والاشتراكات والمحتوى — منفصلة عن بوابات العملاء والملاك والمستأجرين.'
              : 'One space for operations, security, subscriptions, and content — separate from customer, owner, and tenant portals.'}
          </p>
        </div>
      </header>

      {pulse ? (
        <div className="sa-hub__pulse" aria-label={ar ? 'مؤشرات لحظية' : 'Live pulse'}>
          <article className="sa-hub__stat">
            <span>{ar ? 'منشآت' : 'Orgs'}</span>
            <strong dir="ltr">{pulse.organizations}</strong>
          </article>
          <article className="sa-hub__stat">
            <span>{ar ? 'مستخدمون' : 'Users'}</span>
            <strong dir="ltr">{pulse.users}</strong>
          </article>
          <article className="sa-hub__stat">
            <span>{ar ? 'جلسات نشطة' : 'Sessions'}</span>
            <strong dir="ltr">{pulse.activeSessions}</strong>
          </article>
          <article className="sa-hub__stat">
            <span>{ar ? 'طابور البريد' : 'Outbox'}</span>
            <strong dir="ltr">{pulse.openOutbox}</strong>
          </article>
        </div>
      ) : (
        <div className="sa-hub__pulse sa-hub__pulse--loading" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      <div className="sa-hub__modules">
        {modules.map(({ group, label, items }) => (
          <section key={group} className="sa-hub__module">
            <header className="sa-hub__module-head">
              <h2>{ar ? label.ar : label.en}</h2>
            </header>
            <div className="sa-hub__grid">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={item.path}
                  className="sa-hub__tile"
                  prefetch={false}
                  data-no-progress=""
                  onClick={(event) => {
                    if (
                      !event.defaultPrevented &&
                      event.button === 0 &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    ) {
                      event.preventDefault();
                      pushSoftPortalUrl(event.currentTarget.href);
                    }
                  }}
                >
                  <strong>{ar ? item.ar : item.en}</strong>
                  <span>{ar ? item.hintAr : item.hintEn}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
