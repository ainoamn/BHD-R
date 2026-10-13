import 'server-only';
import { notFound } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { ApprovalPolicyCard } from '@/components/approval-policy-card';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { DEFAULT_APPROVAL_POLICY } from '@/lib/approval-policy';
import { loadOwnerApprovalPolicy } from '@/lib/approval-policy-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { LeaseMinTermCard } from '@/components/lease-min-term-card';
import { loadOwnerBookingTerms } from '@/lib/booking-terms-neon';
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
  const [data, minTerm, approval] = await Promise.all([
    loadOwnerBookingTerms(scope, propertyId),
    loadOwnerLeaseMinTerm(scope, propertyId).catch(() => null),
    loadOwnerApprovalPolicy(scope, propertyId).catch(() => null),
  ]);
  if (!data) notFound();

  return (
    <>
      {approval ? (
        <ApprovalPolicyCard
          locale={locale}
          propertyId={propertyId}
          initialPolicy={approval.own?.policy ?? null}
          delegateName={approval.own?.delegate?.name ?? null}
          inherited={approval.inherited ?? { source: 'default', policy: DEFAULT_APPROVAL_POLICY }}
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
