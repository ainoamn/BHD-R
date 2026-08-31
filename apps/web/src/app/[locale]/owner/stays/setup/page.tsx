import { notFound } from 'next/navigation';
import { StaySetupWizard } from '@/components/stays/stay-setup-wizard';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const { propertyId } = await searchParams;
  const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health').catch(() => null);

  return (
    <StaySetupWizard
      locale={locale}
      portal="owner"
      propertyId={propertyId ?? null}
      apiAvailable={Boolean(health)}
    />
  );
}
