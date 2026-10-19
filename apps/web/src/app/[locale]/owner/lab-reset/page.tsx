import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { LabResetDesk } from '@/components/lab-reset-desk';
import { requirePortal, requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  await requirePortalPath('owner', '/lab-reset');
  return <LabResetDesk locale={locale} />;
}

export default persistentPortalPage('/owner/lab-reset', Page);
