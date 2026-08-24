import { EmptyState } from '@bhd-r/ui';
import { apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';

interface ReservationRow {
  id: string;
  unitId: string;
  status: string;
  expiresAt: string;
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  await requirePortal(locale, 'tenant');
  const reservations = await apiFetch<ReservationRow[]>('/v1/leasing/reservations');
  return (
    <div className="form-shell">
      <header className="portal-topbar">
        <div>
          <h1>{ar ? 'حجوزاتي ومستنداتي' : 'My reservations & documents'}</h1>
          <p>
            {ar
              ? 'تابع متطلبات الحجز قبل إعداد العقد.'
              : 'Complete booking requirements before contract preparation.'}
          </p>
        </div>
      </header>
      {reservations.length ? (
        <div className="ops-panel data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{ar ? 'الحجز' : 'Reservation'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
                <th>{ar ? 'الانتهاء' : 'Expires'}</th>
                <th>{ar ? 'الإجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td>{reservation.id.slice(0, 8)}</td>
                  <td>{reservation.status}</td>
                  <td>
                    {new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', {
                      dateStyle: 'medium',
                    }).format(new Date(reservation.expiresAt))}
                  </td>
                  <td>
                    <a
                      className="ops-action"
                      href={`/${locale}/tenant/reservations/${reservation.id}`}
                    >
                      {ar ? 'المتطلبات والمستندات' : 'Requirements & documents'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={ar ? 'لا توجد حجوزات' : 'No reservations'} />
      )}
    </div>
  );
}
