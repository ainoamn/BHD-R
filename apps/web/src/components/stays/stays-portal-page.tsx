import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { PortalRole } from '@/lib/types';

export type StaysPortalSection = 'dashboard' | 'calendar' | 'bookings' | 'rates' | 'setup';

const sectionHref: Record<Exclude<StaysPortalSection, 'setup'>, string> = {
  dashboard: '',
  calendar: '/calendar',
  bookings: '/bookings',
  rates: '/rates',
};

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
              ? 'إدارة حجوزات الإقامة اليومية والتقويم والأسعار من مكان واحد.'
              : 'Manage daily stay bookings, calendar, and rates in one place.'}
          </p>
        </div>
      </header>

      <nav className="purpose-tabs stays-portal__tabs" aria-label={title}>
        {(
          [
            ['dashboard', t('dashboard')],
            ['calendar', t('calendar')],
            ['bookings', t('bookings')],
            ['rates', t('rates')],
          ] as const
        ).map(([id, label]) => {
          const href = `${root}${sectionHref[id]}`;
          const active = section === id;
          return (
            <Link
              key={id}
              href={href}
              prefetch
              scroll={false}
              className={active ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
              aria-current={active ? 'page' : undefined}
            >
              {label}
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
