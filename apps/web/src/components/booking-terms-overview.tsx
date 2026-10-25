import 'server-only';
import { EmptyState } from '@bhd-r/ui';
import { ApprovalPolicyCard } from '@/components/approval-policy-card';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { LeaseDocumentRulesCard } from '@/components/lease-document-rules-card';
import { loadOwnerApprovalPolicyBundle } from '@/lib/approval-policy-neon';
import { DEFAULT_LEASE_DOCUMENT_RULES } from '@/lib/lease-document-rules';
import { loadOwnerLeaseDocumentRules } from '@/lib/lease-document-rules-neon';
import { BookingTermsPropertyList } from '@/components/booking-terms-property-list';
import { TermsLetterheadEditor } from '@/components/terms-letterhead-editor';
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

  const scope = {
    organizationId: viewer.organizationId,
    userId: viewer.id,
    partyId: viewer.partyId ?? null,
    roles: viewer.roles,
  };
  let overview: Overview | null = null;
  try {
    overview = await loadBookingTermsOverview(scope);
  } catch (error) {
    console.error('booking terms overview failed', error);
  }
  const [approval, documentRules] = await Promise.all([
    loadOwnerApprovalPolicyBundle(scope, null).catch(() => null),
    loadOwnerLeaseDocumentRules(scope, null).catch(() => null),
  ]);

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
      {approval ? (
        <ApprovalPolicyCard
          locale={locale}
          propertyId={null}
          kinds={approval.kinds.map((row) => ({
            kind: row.kind,
            initialPolicy: row.own?.policy ?? null,
            delegateName: row.own?.delegate?.name ?? null,
            inherited: row.inherited,
          }))}
        />
      ) : null}
      {documentRules ? (
        <LeaseDocumentRulesCard
          locale={locale}
          propertyId={null}
          initialRules={documentRules.own?.rules ?? null}
          inherited={{ source: 'default', rules: DEFAULT_LEASE_DOCUMENT_RULES }}
        />
      ) : null}
      <BookingTermsEditor
        locale={locale}
        portal={portal}
        target={{ kind: 'organization' }}
        initialTerms={overview.organizationTerms}
        letterhead={overview.letterhead}
      />

      <TermsLetterheadEditor locale={locale} initial={overview.letterhead} />

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
