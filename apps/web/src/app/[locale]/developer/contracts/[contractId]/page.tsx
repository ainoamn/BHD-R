import { ContractDetailView } from '@/components/contract-detail-view';

export default async function DeveloperContractPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractDetailView portal="developer" locale={locale} contractId={contractId} />;
}
