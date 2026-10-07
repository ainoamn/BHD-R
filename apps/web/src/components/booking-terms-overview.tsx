import 'server-only';
import { EmptyState } from '@bhd-r/ui';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { BookingTermsPropertyList } from '@/components/booking-terms-property-list';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
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
          <BookingTermsPropertyList
            locale={locale}
            portal={portal}
            rows={rows}
            templateSaved={{
              sale: Boolean(templateSaved.sale),
              rent: Boolean(templateSaved.rent),
              daily: Boolean(templateSaved.daily),
            }}
          />
        )}
      </div>
    </>
  );
}
