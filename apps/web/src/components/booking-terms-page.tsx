import 'server-only';
import { notFound } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { BookingTermsEditor } from '@/components/booking-terms-editor';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadOwnerBookingTerms } from '@/lib/booking-terms-neon';
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

  const data = await loadOwnerBookingTerms(
    {
      organizationId: viewer.organizationId,
      userId: viewer.id,
      partyId: viewer.partyId,
      roles: viewer.roles,
    },
    propertyId,
  );
  if (!data) notFound();

  return (
    <BookingTermsEditor
      locale={locale}
      portal={portal}
      target={{ kind: 'property', property: data.property }}
      initialTerms={data.terms}
      organizationTerms={data.organizationTerms}
    />
  );
}
