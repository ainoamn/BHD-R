import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { ContractDetailView } from '@/components/contract-detail-view';

async function OwnerContractPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractDetailView portal="owner" locale={locale} contractId={contractId} />;
}

export default persistentPortalPage('/owner/contracts/[contractId]', OwnerContractPage);
