import 'server-only';
import { EmptyState } from '@bhd-r/ui';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { Link } from '@/i18n/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { BOOKING_TERMS_MODES, bookingTermsModeLabel } from '@/lib/booking-terms';
import {
  loadBookingTermsOverview,
  type BookingTermsOverview as Overview,
} from '@/lib/booking-terms-neon';
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

  let overview: Overview | null = null;
  try {
    overview = await loadBookingTermsOverview({
      organizationId: viewer.organizationId,
      userId: viewer.id,
      partyId: viewer.partyId ?? null,
      roles: viewer.roles,
    });
  } catch (error) {
    console.error('booking terms overview failed', error);
  }

  if (!overview) {
    return (
      <div className="form-shell booking-terms-overview">
        <p className="notice notice--error" role="alert">
          {ar
            ? 'تعذّر تحميل الشروط والأحكام مؤقتاً — أعد تحميل الصفحة.'
            : 'Could not load terms right now — reload the page.'}
        </p>
      </div>
    );
  }

  const rows = overview.properties;
  const templateSaved = overview.organizationTerms;

  return (
    <>
      <BookingTermsEditor
        locale={locale}
        portal={portal}
        target={{ kind: 'organization' }}
        initialTerms={overview.organizationTerms}
      />

      <div className="form-shell booking-terms-overview">
        <header className="property-manage-hub__header">
          <div>
            <h2>{ar ? 'شروط العقارات' : 'Property terms'}</h2>
            <p className="muted">
              {ar
                ? 'كل عقار يستورد الصيغة الموحدة أعلاه كما هي. اختر عقاراً لتخصيص شروطه إن احتاج شروطاً مختلفة.'
                : 'Every property inherits the standard terms above as-is. Pick a property to customize its terms.'}
            </p>
          </div>
        </header>

        {rows.length === 0 ? (
          <EmptyState
            title={ar ? 'لا توجد عقارات بعد' : 'No properties yet'}
            description={
              ar
                ? 'أضف عقاراً أولاً — سيستخدم الصيغة الموحدة تلقائياً.'
                : 'Add a property first — it will use the standard terms automatically.'
            }
          />
        ) : (
          <ul className="booking-terms-overview__list">
            {rows.map((row) => (
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
                      const custom = row.versions[mode];
                      const label = custom
                        ? ar
                          ? `مخصّصة (إصدار ${custom.version})`
                          : `custom (v${custom.version})`
                        : templateSaved[mode]
                          ? ar
                            ? 'الصيغة الموحدة'
                            : 'standard'
                          : ar
                            ? 'افتراضية'
                            : 'default';
                      return (
                        <span
                          key={mode}
                          className={
                            custom
                              ? 'booking-terms-editor__badge'
                              : 'booking-terms-editor__badge booking-terms-overview__badge--default'
                          }
                        >
                          {bookingTermsModeLabel(mode, ar)}: {label}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <Link
                  className="button button--quiet"
                  href={`/${portal}/properties/${row.id}/terms`}
                  prefetch={false}
                >
                  {ar ? 'تخصيص الشروط' : 'Customize terms'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
