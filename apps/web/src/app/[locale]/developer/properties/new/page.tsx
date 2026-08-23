import { EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { PropertyWizard } from '@/components/property-wizard';
import { requirePortal } from '@/lib/viewer';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const viewer = await requirePortal(locale, 'developer');
  const t = await getTranslations();
  if (!viewer.partyId) return <EmptyState title={t('Portal.noData')} />;
  return <PropertyWizard ownerPartyId={viewer.partyId} portal="developer" />;
}
