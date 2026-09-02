import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import { Link } from '@/i18n/navigation';
import {
  StayPerformancePanel,
  type StayPerformanceMetrics,
} from '@/components/stays/stay-performance-panel';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  countOwnerStayBookingsOnNeon,
  listOwnerStayBookingsOnNeon,
} from '@/lib/owner-stays-ops-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';
import { formatMoney } from '@/lib/format';

function defaultRange(): { fromOn: string; toOn: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    fromOn: from.toISOString().slice(0, 10),
    toOn: to.toISOString().slice(0, 10),
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const ar = locale === 'ar';
  const { fromOn, toOn } = defaultRange();
  const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health').catch(() => null);
  const metrics = await apiFetch<StayPerformanceMetrics>(
    `/v1/stays/reports/performance?fromOn=${encodeURIComponent(fromOn)}&toOn=${encodeURIComponent(toOn)}`,
  ).catch(() => null);

  let bookingCount = { total: 0, confirmed: 0, pending: 0 };
  let recent: Awaited<ReturnType<typeof listOwnerStayBookingsOnNeon>>['items'] = [];
  if (hasDatabaseUrl()) {
    try {
      const token = (await cookies()).get('bhd_r_session')?.value;
      if (token) {
        const claims = await verifySessionToken(token, requireSessionSecret());
        bookingCount = await countOwnerStayBookingsOnNeon(claims);
        recent = (await listOwnerStayBookingsOnNeon(claims, { limit: 5 })).items;
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <StaysPortalPage locale={locale} portal="owner" section="dashboard">
      <ul className="stays-portal__stats">
        <li>
          <span>{ar ? 'إجمالي الحجوزات' : 'Total bookings'}</span>
          <strong>{bookingCount.total}</strong>
        </li>
        <li>
          <span>{ar ? 'مؤكّدة' : 'Confirmed'}</span>
          <strong>{bookingCount.confirmed}</strong>
        </li>
        <li>
          <span>{ar ? 'بانتظار الدفع' : 'Pending payment'}</span>
          <strong>{bookingCount.pending}</strong>
        </li>
        <li>
          <span>{ar ? 'حالة الواجهة' : 'API status'}</span>
          <strong dir="ltr">{health ? 'reachable' : 'offline / gated'}</strong>
        </li>
      </ul>

      <section className="stays-portal__recent">
        <div className="dash-section-head">
          <h2>{ar ? 'أحدث الحجوزات' : 'Latest bookings'}</h2>
          <Link href="/owner/stays/bookings">{ar ? 'عرض الكل' : 'View all'}</Link>
        </div>
        {recent.length ? (
          <ul className="stays-portal__recent-list">
            {recent.map((booking) => (
              <li key={booking.id}>
                <div>
                  <strong dir="ltr">{booking.referenceCode}</strong>
                  <span className="muted">
                    {booking.checkInOn} → {booking.checkOutOn}
                  </span>
                </div>
                <div>
                  <span>{booking.status}</span>
                  <strong dir="ltr">
                    {formatMoney(booking.totalMinor, booking.currency, locale)}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {ar
              ? 'ستظهر حجوزات الضيوف هنا بعد إتمام الحجز العام.'
              : 'Guest bookings appear here after public checkout.'}
          </p>
        )}
      </section>

      <h2 className="stays-performance__title">
        {ar ? 'أداء 30 يوماً' : 'Last 30 days performance'}
      </h2>
      <StayPerformancePanel locale={locale} metrics={metrics} />
    </StaysPortalPage>
  );
}
