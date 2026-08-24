import { ContractDetailView } from '@/components/contract-detail-view';
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale, contractId } = await params;
  return <ContractDetailView portal="tenant" locale={locale} contractId={contractId} />;
}
