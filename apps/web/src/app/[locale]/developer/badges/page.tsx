import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { BadgesCenterBoard } from '@/components/badges/badges-center-board';
import { requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requirePortalPath('developer', '/badges');
  const { locale: rawLocale } = await params;
  return <BadgesCenterBoard locale={rawLocale === 'en' ? 'en' : 'ar'} portal="developer" />;
}

export default persistentPortalPage('/developer/badges', Page);
