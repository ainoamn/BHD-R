import { ContractDetailView } from '@/components/contract-detail-view';

export default async function OwnerContractPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractDetailView portal="owner" locale={locale} contractId={contractId} />;
}
