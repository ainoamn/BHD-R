import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { notFound } from 'next/navigation';
import { StaysDashboardPage } from '@/components/stays/stays-dashboard-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  await requirePortalPath('owner', '/stays');
  const { locale } = await params;
  return <StaysDashboardPage locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/stays', Page);
