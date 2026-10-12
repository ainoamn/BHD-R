import { notFound } from 'next/navigation';
import { ContractAnnexView } from '@/components/contract-annex-view';
import { isContractAnnexKind } from '@/lib/contract-annex';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

async function OwnerContractAnnexPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string; annex: string }>;
}) {
  const { locale, contractId, annex } = await params;
  if (!isContractAnnexKind(annex)) notFound();
  return <ContractAnnexView portal="owner" locale={locale} contractId={contractId} kind={annex} />;
}

export default persistentPortalPage(
  '/owner/contracts/[contractId]/annex/[annex]',
  OwnerContractAnnexPage,
);
