import type { PortalRole } from '@/lib/types';
import {
  StaysPortalNav,
  staysSectionLabel,
  type StaysPortalSection,
} from '@/components/stays/stays-portal-nav';

export type { StaysPortalSection };

function sectionIntro(section: StaysPortalSection, ar: boolean): string {
  switch (section) {
    case 'dashboard':
      return ar
        ? 'نظرة سريعة على حركة اليوم والحجوزات القادمة ووحداتك المعروضة للإيجار اليومي.'
        : "Today's movements, upcoming bookings and your daily-rental units at a glance.";
    case 'calendar':
      return ar
        ? 'الأيام الحمراء فيها حجوزات والخضراء شاغرة. اضغط على يوم لعرض حجوزاته، واختر وحدة لتعديل سعر يوم أو إغلاقه.'
        : 'Red days have bookings, green days are free. Tap a day to see its bookings; pick a unit to change a day’s price or close it.';
    case 'rates':
      return ar
        ? 'السعر الأساسي لكل وحدة يُطبَّق على كل الأيام. للعروض وأسعار أيام معيّنة استخدم التقويم.'
        : 'Each unit’s base price applies to every day. Use the calendar for offers and specific-day prices.';
    case 'bookings':
      return ar
        ? 'كل حجوزات الإقامة اليومية مع حالتها وإجراءاتها.'
        : 'Every daily-stay booking with its status and actions.';
    default:
      return '';
  }
}

export function StaysPortalPage({
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
  const ar = locale === 'ar';
  const intro = sectionIntro(section, ar);

  return (
    <div className="form-shell stays-portal">
      <StaysPortalNav locale={locale} portal={portal} section={section} />

      <header className="stays-portal__header">
        <h1>{staysSectionLabel(section, ar)}</h1>
        {intro ? <p className="muted">{intro}</p> : null}
      </header>

      <div className="stays-portal__body" aria-live="polite">
        {children ?? (
          <p className="pmh-empty">{ar ? 'قريباً — الخدمة قيد التفعيل.' : 'Coming online soon.'}</p>
        )}
      </div>
    </div>
  );
}
