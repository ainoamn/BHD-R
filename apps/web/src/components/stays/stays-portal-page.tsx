import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { PortalRole } from '@/lib/types';

export type StaysPortalSection = 'dashboard' | 'calendar' | 'bookings' | 'rates' | 'setup';

export async function StaysPortalPage({
  locale,
  portal,
  section,
  children,
}: {
  locale: string;
  portal: Extract<PortalRole, 'owner' | 'developer'>;
  section: StaysPortalSection;
  children?: React.ReactNode;
}) {
  const t = await getTranslations('Stays');
  const root = `/${portal}/stays`;
  const title =
    section === 'dashboard'
      ? t('dashboard')
      : section === 'calendar'
        ? t('calendar')
        : section === 'bookings'
          ? t('bookings')
          : section === 'rates'
            ? t('rates')
            : t('setup');

  const tabs = [
    { id: 'dashboard' as const, label: t('dashboard'), href: root },
    { id: 'calendar' as const, label: t('calendar'), href: `${root}/calendar` },
    {
      id: 'bookings' as const,
      label: t('bookings'),
      href: `/${portal}/bookings?tab=daily`,
    },
    { id: 'rates' as const, label: t('rates'), href: `${root}/rates` },
  ];

  return (
    <div className="form-shell stays-portal">
      <header className="stays-portal__header">
        <div>
          <span className="ops-kicker">
            BHD R · {locale === 'ar' ? 'الإقامات اليومية' : 'Daily stays'}
          </span>
          <h1>{title}</h1>
          <p className="muted">
            {locale === 'ar'
              ? 'التقويم والأسعار هنا؛ الحجوزات اليومية ضمن شاشة الحجوزات والمعاينات الموحّدة.'
              : 'Calendar and rates stay here; daily bookings live on the unified bookings & viewings screen.'}
          </p>
        </div>
      </header>

      <nav className="purpose-tabs stays-portal__tabs" aria-label={title}>
        {tabs.map((tab) => {
          const active = section === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              prefetch
              scroll={false}
              className={active ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <section className="ops-panel stays-portal__panel" aria-live="polite">
        {children ?? (
          <p className="muted">
            {t('comingOnline')} — <code dir="ltr">/v1/stays/*</code>
          </p>
        )}
      </section>
    </div>
  );
}
