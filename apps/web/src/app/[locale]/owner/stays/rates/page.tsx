import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { notFound } from 'next/navigation';
import { StaysRatesPage } from '@/components/stays/stays-rates-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  return <StaysRatesPage locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/stays/rates', Page);
