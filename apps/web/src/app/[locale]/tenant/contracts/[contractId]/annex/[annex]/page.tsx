import { notFound } from 'next/navigation';
import { ContractAnnexView } from '@/components/contract-annex-view';
import { isContractAnnexKind } from '@/lib/contract-annex';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; contractId: string; annex: string }>;
}) {
  const { locale, contractId, annex } = await params;
  if (!isContractAnnexKind(annex)) notFound();
  return <ContractAnnexView portal="tenant" locale={locale} contractId={contractId} kind={annex} />;
}
