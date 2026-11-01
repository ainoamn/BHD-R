import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ContractAdminInspect } from '@/components/site-admin/contract-admin-inspect';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'عقد · اطّلاع إداري',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminContractPage({
  params,
}: {
  params: Promise<{ locale: string; contractId: string }>;
}) {
  const { locale: raw, contractId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'users', {
    path: `/admin/contracts/${contractId}`,
  });
  return <ContractAdminInspect locale={locale} contractId={contractId} />;
}
