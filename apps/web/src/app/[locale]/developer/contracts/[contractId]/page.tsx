import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { ContractDetailView } from '@/components/contract-detail-view';

async function DeveloperContractPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractDetailView portal="developer" locale={locale} contractId={contractId} />;
}

export default persistentPortalPage('/developer/contracts/[contractId]', DeveloperContractPage);
