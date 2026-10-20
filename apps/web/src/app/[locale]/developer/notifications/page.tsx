import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { NotificationTemplatesStudio } from '@/components/notification-templates-studio';
import { requirePortal, requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'developer');
  await requirePortalPath('developer', '/notifications');
  return <NotificationTemplatesStudio locale={locale} />;
}

export default persistentPortalPage('/developer/notifications', Page);
