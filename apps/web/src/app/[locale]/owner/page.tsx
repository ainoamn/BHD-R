import { redirect } from 'next/navigation';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { OwnerDashboard } from '@/components/owner-dashboard';
import { lawyerParty } from '@/lib/portal-access';
import { getShellViewer } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const viewer = await getShellViewer();
  if (viewer && lawyerParty(viewer)) redirect(`/${locale === 'en' ? 'en' : 'ar'}/owner/legal`);
  return <OwnerDashboard locale={locale} />;
}

export default persistentPortalPage('/owner', Page);
