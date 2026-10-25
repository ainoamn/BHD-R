import 'server-only';
import { notFound } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { ApprovalPolicyCard } from '@/components/approval-policy-card';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { LeaseDocumentRulesCard } from '@/components/lease-document-rules-card';
import { LeaseMinTermCard } from '@/components/lease-min-term-card';
import { loadOwnerApprovalPolicyBundle } from '@/lib/approval-policy-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadOwnerBookingTerms } from '@/lib/booking-terms-neon';
import { DEFAULT_LEASE_DOCUMENT_RULES } from '@/lib/lease-document-rules';
import { loadOwnerLeaseDocumentRules } from '@/lib/lease-document-rules-neon';
import { loadOwnerLeaseMinTerm } from '@/lib/lease-min-term-neon';
import { requirePortal } from '@/lib/viewer';

export async function BookingTermsPage({
  locale,
  portal,
  propertyId,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  propertyId: string;
}) {
  const viewer = await requirePortal(locale, portal);
  const ar = locale === 'ar';
  if (!viewer.organizationId || !hasDatabaseUrl()) {
    return <EmptyState title={ar ? 'لا توجد بيانات' : 'No data'} />;
  }
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) notFound();

  const scope = {
    organizationId: viewer.organizationId,
    userId: viewer.id,
    partyId: viewer.partyId,
    roles: viewer.roles,
  };
  const [data, minTerm, approval, documentRules] = await Promise.all([
    loadOwnerBookingTerms(scope, propertyId),
    loadOwnerLeaseMinTerm(scope, propertyId).catch(() => null),
    loadOwnerApprovalPolicyBundle(scope, propertyId).catch(() => null),
    loadOwnerLeaseDocumentRules(scope, propertyId).catch(() => null),
  ]);
  if (!data) notFound();

  return (
    <>
      {approval ? (
        <ApprovalPolicyCard
          locale={locale}
          propertyId={propertyId}
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
          propertyId={propertyId}
          initialRules={documentRules.own?.rules ?? null}
          inherited={
            documentRules.inherited ?? { source: 'default', rules: DEFAULT_LEASE_DOCUMENT_RULES }
          }
        />
      ) : null}
      <LeaseMinTermCard locale={locale} propertyId={propertyId} initialMonths={minTerm} />
      <BookingTermsEditor
        locale={locale}
        portal={portal}
        target={{ kind: 'property', property: data.property }}
        initialTerms={data.terms}
        organizationTerms={data.organizationTerms}
        letterhead={data.letterhead}
      />
    </>
  );
}
