import { ContractChequeAnnexView } from '@/components/contract-cheque-annex-view';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

async function DeveloperChequeAnnexPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractChequeAnnexView portal="developer" locale={locale} contractId={contractId} />;
}

export default persistentPortalPage(
  '/developer/contracts/[contractId]/cheques',
  DeveloperChequeAnnexPage,
);
