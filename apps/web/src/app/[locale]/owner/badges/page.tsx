import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { BadgesCenterBoard } from '@/components/badges/badges-center-board';
import { requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requirePortalPath('owner', '/badges');
  const { locale: rawLocale } = await params;
  return <BadgesCenterBoard locale={rawLocale === 'en' ? 'en' : 'ar'} portal="owner" />;
}

export default persistentPortalPage('/owner/badges', Page);
