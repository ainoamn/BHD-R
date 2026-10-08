import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from '@/components/pmh-icon';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { staysSectionHref } from '@/components/stays/stays-portal-nav';
import type { OpsStayBooking } from '@/components/stays/stay-ops-bookings-table';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { formatMoney } from '@/lib/format';
import {
  countOwnerStayBookingsOnNeon,
  listOwnerStayBookingsOnNeon,
  stayTodayIso,
} from '@/lib/owner-stays-ops-neon';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';
import { apiFetch } from '@/lib/server-api';
import { loadPropertyStaySettingsOnNeon } from '@/lib/stay-setup-neon';
import { readSessionClaimsFromCookies } from '@/lib/stay-setup-session';
import { stayStatusLabel } from '@/lib/ui-labels';

type StayPerformanceMetrics = {
  fromOn: string;
  toOn: string;
  currency: string | null;
  availableRoomNights: number;
  occupiedRoomNights: number;
  roomRevenueMinor: string;
  occupancyPercent: string | null;
  adrMinor: string | null;
  revparMinor: string | null;
  bookingCount: number;
};

type Counts = Awaited<ReturnType<typeof countOwnerStayBookingsOnNeon>>;

const EMPTY_COUNTS: Counts = {
  total: 0,
  confirmed: 0,
  pending: 0,
  arrivalsToday: 0,
  departuresToday: 0,
  inHouse: 0,
  upcoming: 0,
};

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDate(iso: string, ar: boolean): string {
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

function statusTone(status: string): string {
  if (status === 'request_pending' || status === 'payment_pending') return 'warn';
  if (['confirmed', 'paid', 'pre_arrival', 'checked_in'].includes(status)) return 'ready';
  return 'muted';
}

function publishBadge(status: string, ar: boolean): { text: string; tone: string } {
  if (status === 'published') return { text: ar ? 'منشور' : 'Published', tone: 'ready' };
  if (status === 'unpublished') return { text: ar ? 'غير منشور' : 'Unpublished', tone: 'muted' };
  return { text: ar ? 'مسودة' : 'Draft', tone: 'warn' };
}

function Card({
  title,
  icon,
  link,
  children,
}: {
  title: string;
  icon: IconName;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="pmh-card">
      <header className="pmh-card__head">
        <h2>
          <span className="pmh-card__icon">
            <Icon name={icon} />
          </span>
          {title}
        </h2>
        {link ? (
          <Link className="pmh-card__link" href={link.href} prefetch>
            {link.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

async function loadDashboard(today: string) {
  const fromOn = shiftDays(today, -30);
  const metricsPromise = apiFetch<StayPerformanceMetrics>(
    `/v1/stays/reports/performance?fromOn=${fromOn}&toOn=${today}`,
  ).catch(() => null);

  let counts = EMPTY_COUNTS;
  let upcoming: OpsStayBooking[] = [];
  let units: PropertyStaySettingsUnit[] = [];
  const claims = hasDatabaseUrl() ? await readSessionClaimsFromCookies() : null;
  if (claims?.organizationId) {
    const [countsResult, upcomingResult, unitsResult] = await Promise.allSettled([
      countOwnerStayBookingsOnNeon(claims, today),
      listOwnerStayBookingsOnNeon(claims, { limit: 6, upcomingFrom: today }),
      loadPropertyStaySettingsOnNeon(claims, null),
    ]);
    if (countsResult.status === 'fulfilled') counts = countsResult.value;
    if (upcomingResult.status === 'fulfilled') upcoming = upcomingResult.value.items;
    if (unitsResult.status === 'fulfilled') units = unitsResult.value;
  }
  return { counts, upcoming, units, metrics: await metricsPromise };
}

export async function StaysDashboardPage({
  locale,
  portal,
}: {
  locale: string;
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const today = stayTodayIso();
  const { counts, upcoming, units, metrics } = await loadDashboard(today);
  const base = `/${portal}`;
  const bookingsHref = staysSectionHref(portal, 'bookings');
  const ratesHref = staysSectionHref(portal, 'rates');
  const calendarHref = staysSectionHref(portal, 'calendar');

  const stats: Array<{ icon: IconName; label: string; value: number; hint: string }> = [
    {
      icon: 'arrivals',
      label: ar ? 'وصول اليوم' : 'Arriving today',
      value: counts.arrivalsToday,
      hint: ar ? `داخل العقار الآن: ${counts.inHouse}` : `In-house now: ${counts.inHouse}`,
    },
    {
      icon: 'departures',
      label: ar ? 'مغادرة اليوم' : 'Leaving today',
      value: counts.departuresToday,
      hint: ar ? 'بعد المبيت' : 'After an overnight stay',
    },
    {
      icon: 'calendar',
      label: ar ? 'حجوزات قادمة' : 'Upcoming bookings',
      value: counts.upcoming,
      hint: ar ? 'مؤكدة، من الغد فصاعداً' : 'Confirmed, from tomorrow on',
    },
    {
      icon: 'alert',
      label: ar ? 'تحتاج إجراء' : 'Need action',
      value: counts.pending,
      hint: ar ? 'بانتظار الدفع أو الاعتماد' : 'Awaiting payment or approval',
    },
  ];

  const money = (minor: string | null) =>
    minor == null || !metrics?.currency ? '—' : formatMoney(minor, metrics.currency, locale);

  return (
    <StaysPortalPage locale={locale} portal={portal} section="dashboard">
      <section className="pmh-stats" aria-label={ar ? 'حركة اليوم' : "Today's movements"}>
        {stats.map((stat) => (
          <article key={stat.label}>
            <span className="pmh-stats__icon">
              <Icon name={stat.icon} />
            </span>
            <div>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <small>{stat.hint}</small>
            </div>
          </article>
        ))}
      </section>

      <div className="pmh-grid">
        <div className="pmh-grid__main">
          <Card
            title={ar ? 'الحجوزات القادمة' : 'Upcoming bookings'}
            icon="calendar"
            link={{ href: bookingsHref, label: ar ? 'كل الحجوزات' : 'All bookings' }}
          >
            {upcoming.length ? (
              <ul className="pmh-list">
                {upcoming.map((booking) => {
                  const property = ar
                    ? booking.propertyNameAr || booking.propertyNameEn
                    : booking.propertyNameEn || booking.propertyNameAr;
                  const unit =
                    (ar
                      ? booking.unitNameAr || booking.unitNameEn
                      : booking.unitNameEn || booking.unitNameAr) || booking.unitCode;
                  const isToday = booking.checkInOn === today;
                  return (
                    <li key={booking.id}>
                      <Link href={`${base}/stays/bookings/${booking.id}`} prefetch>
                        <div className="pmh-list__main">
                          <strong>
                            {booking.guestDisplayName || (ar ? 'ضيف' : 'Guest')}
                            {isToday ? (
                              <em className="stays-dash__today">{ar ? 'اليوم' : 'Today'}</em>
                            ) : null}
                          </strong>
                          <span>{[property, unit].filter(Boolean).join(' · ')}</span>
                        </div>
                        <div className="pmh-list__meta">
                          <span>
                            {shortDate(booking.checkInOn, ar)} {ar ? '←' : '→'}{' '}
                            {shortDate(booking.checkOutOn, ar)}
                          </span>
                          <span className="pmh-list__amount" dir="ltr">
                            {formatMoney(booking.totalMinor, booking.currency, locale)}
                          </span>
                        </div>
                        <span className={`pmh-badge pmh-badge--${statusTone(booking.status)}`}>
                          {stayStatusLabel(booking.status, locale)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="pmh-empty">
                {ar
                  ? 'لا حجوزات قادمة الآن. تظهر هنا الحجوزات المؤكدة من اليوم فصاعداً.'
                  : 'No upcoming bookings. Confirmed bookings from today onward appear here.'}
              </p>
            )}
          </Card>

          <Card
            title={ar ? 'وحداتك للإيجار اليومي' : 'Your daily-rental units'}
            icon="bed"
            link={{ href: ratesHref, label: ar ? 'تعديل الأسعار' : 'Edit prices' }}
          >
            {units.length ? (
              <div className="pmh-units">
                {units.map((unit) => {
                  const badge = publishBadge(unit.publishStatus, ar);
                  const property = ar
                    ? unit.propertyNameAr || unit.propertyNameEn
                    : unit.propertyNameEn || unit.propertyNameAr;
                  const unitName =
                    (ar
                      ? unit.unitNameAr || unit.unitNameEn
                      : unit.unitNameEn || unit.unitNameAr) || unit.unitCode;
                  return (
                    <article key={unit.profileId} className="pmh-unit">
                      <div className="pmh-unit__main">
                        <strong>{unitName}</strong>
                        <span>{property}</span>
                      </div>
                      <div className="pmh-unit__specs">
                        <span>
                          {ar
                            ? `حتى ${unit.overnightMaxGuests} ضيف`
                            : `Up to ${unit.overnightMaxGuests} guests`}
                        </span>
                        <span>
                          {ar
                            ? `${unit.minNights}–${unit.maxNights} ليلة`
                            : `${unit.minNights}–${unit.maxNights} nights`}
                        </span>
                      </div>
                      <div className="pmh-unit__price">
                        <strong dir="ltr">
                          {unit.baseNightlyMinor
                            ? formatMoney(unit.baseNightlyMinor, unit.currency, locale)
                            : '—'}
                        </strong>
                        <span>{ar ? 'لليلة' : 'per night'}</span>
                      </div>
                      <div className="pmh-unit__badges stays-dash__unit-actions">
                        <span className={`pmh-badge pmh-badge--${badge.tone}`}>{badge.text}</span>
                        <Link
                          className="pmh-card__link"
                          href={`${calendarHref}?unitId=${unit.unitId}`}
                          prefetch
                        >
                          {ar ? 'التقويم' : 'Calendar'}
                        </Link>
                        <Link className="pmh-card__link" href={`${ratesHref}#unit-${unit.unitId}`}>
                          {ar ? 'الأسعار' : 'Prices'}
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="pmh-empty stays-dash__empty">
                <p>
                  {ar
                    ? 'لا وحدات للإيجار اليومي بعد. أضف إقامة يومية لتحديد الأسعار وعدد الضيوف ونشرها.'
                    : 'No daily-rental units yet. Add a daily stay to set prices and guest limits, then publish it.'}
                </p>
                <Link className="button button--primary" href={`${base}/stays/setup`} prefetch>
                  {ar ? 'إضافة إقامة يومية' : 'Add a daily stay'}
                </Link>
              </div>
            )}
          </Card>
        </div>

        <div className="pmh-grid__side">
          <Card title={ar ? 'أداء آخر 30 يوماً' : 'Last 30 days'} icon="chart">
            {metrics ? (
              <dl className="pmh-finance">
                <div>
                  <dt>{ar ? 'نسبة الإشغال' : 'Occupancy'}</dt>
                  <dd dir="ltr">
                    {metrics.occupancyPercent != null ? `${metrics.occupancyPercent}%` : '—'}
                  </dd>
                </div>
                <div>
                  <dt>{ar ? 'الليالي المحجوزة' : 'Booked nights'}</dt>
                  <dd dir="ltr">
                    {metrics.occupiedRoomNights} / {metrics.availableRoomNights}
                  </dd>
                </div>
                <div>
                  <dt>{ar ? 'متوسط سعر الليلة' : 'Average nightly rate'}</dt>
                  <dd dir="ltr">{money(metrics.adrMinor)}</dd>
                </div>
                <div>
                  <dt>{ar ? 'إيراد الإقامات' : 'Stay revenue'}</dt>
                  <dd dir="ltr">{money(metrics.roomRevenueMinor)}</dd>
                </div>
                <div>
                  <dt>{ar ? 'عدد الحجوزات' : 'Bookings'}</dt>
                  <dd dir="ltr">{metrics.bookingCount}</dd>
                </div>
              </dl>
            ) : (
              <p className="pmh-empty">
                {ar
                  ? 'تظهر نسبة الإشغال والإيراد هنا بعد أول حجوزات مؤكدة.'
                  : 'Occupancy and revenue appear here after the first confirmed bookings.'}
              </p>
            )}
          </Card>

          <Card
            title={ar ? 'ملخص الحجوزات' : 'Bookings summary'}
            icon="list"
            link={{ href: bookingsHref, label: ar ? 'إدارة الحجوزات' : 'Manage' }}
          >
            <dl className="pmh-finance">
              <div>
                <dt>{ar ? 'كل الحجوزات' : 'All bookings'}</dt>
                <dd>{counts.total}</dd>
              </div>
              <div>
                <dt>{ar ? 'مؤكدة' : 'Confirmed'}</dt>
                <dd>{counts.confirmed}</dd>
              </div>
              <div>
                <dt>{ar ? 'بانتظار الدفع أو الاعتماد' : 'Awaiting payment or approval'}</dt>
                <dd>{counts.pending}</dd>
              </div>
              <div>
                <dt>{ar ? 'داخل العقار الآن' : 'In-house now'}</dt>
                <dd>{counts.inHouse}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </StaysPortalPage>
  );
}
