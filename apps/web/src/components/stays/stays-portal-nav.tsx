import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from '@/components/pmh-icon';

export type StaysPortalSection = 'dashboard' | 'calendar' | 'bookings' | 'rates' | 'setup';

const SECTIONS: Array<{
  id: Exclude<StaysPortalSection, 'setup'>;
  icon: IconName;
  ar: string;
  en: string;
}> = [
  { id: 'dashboard', icon: 'home', ar: 'لوحة الإقامات', en: 'Stays dashboard' },
  { id: 'calendar', icon: 'calendar', ar: 'التقويم', en: 'Calendar' },
  { id: 'bookings', icon: 'list', ar: 'الحجوزات اليومية', en: 'Daily bookings' },
  { id: 'rates', icon: 'tag', ar: 'الأسعار والعروض', en: 'Rates & offers' },
];

export function staysSectionHref(
  portal: 'owner' | 'developer',
  section: Exclude<StaysPortalSection, 'setup'>,
): string {
  const root = `/${portal}/stays`;
  if (section === 'dashboard') return root;
  if (section === 'bookings') return `/${portal}/bookings?tab=daily`;
  return `${root}/${section}`;
}

export function staysSectionLabel(section: StaysPortalSection, ar: boolean): string {
  if (section === 'setup') return ar ? 'إعداد الإقامة اليومية' : 'Daily stay setup';
  const found = SECTIONS.find((item) => item.id === section)!;
  return ar ? found.ar : found.en;
}

/** Sticky bar shared by every daily-stays screen (dashboard, calendar, bookings, rates). */
export function StaysPortalNav({
  locale,
  portal,
  section,
}: {
  locale: string;
  portal: 'owner' | 'developer';
  section: StaysPortalSection;
}) {
  const ar = locale === 'ar';
  return (
    <nav
      className="pmh-actionbar stays-nav"
      aria-label={ar ? 'أقسام الإقامات اليومية' : 'Daily stays sections'}
    >
      <div className="pmh-actionbar__title">
        <small>BHD R</small>
        <strong>{ar ? 'الإقامات اليومية' : 'Daily stays'}</strong>
      </div>
      <div className="pmh-actionbar__list">
        {SECTIONS.map((item) => {
          const active = item.id === section;
          return (
            <Link
              key={item.id}
              href={staysSectionHref(portal, item.id)}
              prefetch
              scroll={false}
              className={
                active ? 'pmh-action stays-nav__item is-active' : 'pmh-action stays-nav__item'
              }
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {ar ? item.ar : item.en}
            </Link>
          );
        })}
      </div>
      <Link className="pmh-action pmh-action--primary" href={`/${portal}/stays/setup`} prefetch>
        <Icon name="plus" />
        {ar ? 'إضافة إقامة يومية' : 'Add a daily stay'}
      </Link>
    </nav>
  );
}
