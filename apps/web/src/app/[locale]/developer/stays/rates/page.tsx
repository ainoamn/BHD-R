import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { notFound } from 'next/navigation';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  return <StaysPortalPage locale={locale} portal="developer" section="rates" />;
}

export default persistentPortalPage('/developer/stays/rates', Page);
