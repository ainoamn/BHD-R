import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { PortalSettingsDesk } from '@/components/portal-settings-desk';
import { requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requirePortalPath('owner', '/settings');
  const { locale: raw } = await params;
  return <PortalSettingsDesk locale={raw === 'en' ? 'en' : 'ar'} portal="owner" />;
}

export default persistentPortalPage('/owner/settings', Page);
