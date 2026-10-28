import { ContractDetailView } from '@/components/contract-detail-view';
import { TenantRenewalWorkspace } from '@/components/tenant-renewal-workspace';
import { loadContractDetailFromNeon } from '@/lib/contract-detail-neon';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; contractId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { locale: raw, contractId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  const viewer = await requirePortal(locale, 'tenant');

  const contract = await loadContractDetailFromNeon(contractId, 'tenant').catch(() => null);
  const useWorkspace =
    contract?.kind === 'renewal' &&
    ['sent', 'partially_signed', 'signed'].includes(contract.status) &&
    query.view !== 'full';

  if (useWorkspace && contract) {
    return (
      <TenantRenewalWorkspace
        contract={contract}
        locale={locale}
        viewerName={viewer.displayName}
      />
    );
  }

  return <ContractDetailView portal="tenant" locale={locale} contractId={contractId} />;
}
