import 'server-only';
import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { BOOKING_TERMS_MODES, bookingTermsModeLabel } from '@/lib/booking-terms';
import { loadBookingTermsOverview, type BookingTermsOverviewRow } from '@/lib/booking-terms-neon';
import { requirePortal } from '@/lib/viewer';

export async function BookingTermsOverview({
  locale,
  portal,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
}) {
  const viewer = await requirePortal(locale, portal);
  const ar = locale === 'ar';
  if (!viewer.organizationId || !hasDatabaseUrl()) {
    return <EmptyState title={ar ? 'لا توجد بيانات' : 'No data'} />;
  }

  let rows: BookingTermsOverviewRow[] | null = null;
  try {
    rows = await loadBookingTermsOverview({
      organizationId: viewer.organizationId,
      userId: viewer.id,
      partyId: viewer.partyId ?? null,
      roles: viewer.roles,
    });
  } catch (error) {
    console.error('booking terms overview failed', error);
  }

  return (
    <div className="form-shell booking-terms-overview">
      <header className="property-manage-hub__header">
        <div>
          <span className="ops-kicker">BHD R · {ar ? 'الشروط والأحكام' : 'TERMS & CONDITIONS'}</span>
          <h1>{ar ? 'الشروط والأحكام للعقود' : 'Contract terms & conditions'}</h1>
          <p className="muted">
            {ar
              ? 'اختر العقار لتعديل شروط البيع أو الإيجار الشهري/السنوي أو الإيجار اليومي. هذه الشروط يقرؤها المستأجر أو المشتري ويوافق عليها قبل دفع العربون وتوقيع العقد.'
              : 'Pick a property to edit its sale, monthly/yearly rent, or daily rental terms. Tenants and buyers read and accept them before paying the deposit and signing.'}
          </p>
        </div>
      </header>

      {rows === null ? (
        <p className="notice notice--error" role="alert">
          {ar
            ? 'تعذّر تحميل العقارات مؤقتاً — أعد تحميل الصفحة.'
            : 'Could not load properties right now — reload the page.'}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={ar ? 'لا توجد عقارات بعد' : 'No properties yet'}
          description={
            ar
              ? 'أضف عقاراً أولاً ثم عُد لكتابة شروطه.'
              : 'Add a property first, then come back to write its terms.'
          }
        />
      ) : (
        <ul className="booking-terms-overview__list">
          {rows.map((row) => {
            const custom = BOOKING_TERMS_MODES.filter((mode) => row.versions[mode]).length;
            return (
              <li key={row.id} className="booking-terms-overview__item">
                <div className="booking-terms-overview__info">
                  <strong>{ar ? row.nameAr : row.nameEn}</strong>
                  {row.serialNumber ? (
                    <span className="muted" dir="ltr">
                      {row.serialNumber}
                    </span>
                  ) : null}
                  <div className="booking-terms-overview__modes">
                    {BOOKING_TERMS_MODES.map((mode) => {
                      const version = row.versions[mode];
                      return (
                        <span
                          key={mode}
                          className={
                            version
                              ? 'booking-terms-editor__badge'
                              : 'booking-terms-editor__badge booking-terms-overview__badge--default'
                          }
                        >
                          {bookingTermsModeLabel(mode, ar)}:{' '}
                          {version
                            ? ar
                              ? `مخصّصة (إصدار ${version.version})`
                              : `custom (v${version.version})`
                            : ar
                              ? 'افتراضية'
                              : 'default'}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <Link
                  className={`button ${custom ? 'button--quiet' : 'button--primary'}`}
                  href={`/${portal}/properties/${row.id}/terms`}
                  prefetch={false}
                >
                  {ar ? 'تعديل الشروط' : 'Edit terms'}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
