import { notFound } from 'next/navigation';
import { StaySetupWizard } from '@/components/stays/stay-setup-wizard';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { loadStaySetupPageData } from '@/lib/stay-setup-context';

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
  const loaded = await loadStaySetupPageData(propertyId ?? null, locale);

  return (
    <StaySetupWizard
      locale={locale}
      portal="developer"
      propertyId={propertyId ?? null}
      apiAvailable={loaded.apiAvailable}
      apiHint={loaded.apiHint}
      initialContext={loaded.context}
    />
  );
}
