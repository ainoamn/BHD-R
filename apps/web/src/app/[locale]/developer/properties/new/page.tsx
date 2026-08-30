import { EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { PropertyWizard } from '@/components/property-wizard';
import { ensureOwnerPartyId } from '@/lib/bhd/identity-session';
import { listOwnerPartyOptions } from '@/lib/owner-parties';
import { requirePortal } from '@/lib/viewer';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const viewer = await requirePortal(locale, 'developer');
  const t = await getTranslations();
  if (!viewer.organizationId) return <EmptyState title={t('Portal.noData')} />;
  const partyId = await ensureOwnerPartyId({
    userId: viewer.id,
    organizationId: viewer.organizationId,
    displayName: viewer.displayName,
    email: viewer.email?.trim() || `${viewer.id}@identity.bhd-om.local`,
    partyId: viewer.partyId,
  });
  const ownerPartyOptions = await listOwnerPartyOptions(viewer.organizationId).catch(() => [
    { id: partyId, displayName: viewer.displayName, type: 'person' },
  ]);
  return (
    <PropertyWizard
      ownerPartyId={partyId}
      ownerPartyOptions={ownerPartyOptions}
      portal="developer"
    />
  );
}
