import { ContractChequeAnnexView } from '@/components/contract-cheque-annex-view';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

async function OwnerChequeAnnexPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractChequeAnnexView portal="owner" locale={locale} contractId={contractId} />;
}

export default persistentPortalPage(
  '/owner/contracts/[contractId]/cheques',
  OwnerChequeAnnexPage,
);
