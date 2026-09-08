import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { PortalOverview } from '@/components/portal-overview';
async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PortalOverview locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner', Page);
