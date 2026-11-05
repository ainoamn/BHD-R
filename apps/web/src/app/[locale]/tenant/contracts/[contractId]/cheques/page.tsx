import { ContractChequeAnnexView } from '@/components/contract-cheque-annex-view';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractChequeAnnexView portal="tenant" locale={locale} contractId={contractId} />;
}
