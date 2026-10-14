import { AwardCertificateRoute } from '@/components/badges/award-certificate-route';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

async function Page({ params }: { params: Promise<{ locale: string; awardId: string }> }) {
  const { locale: rawLocale, awardId } = await params;
  return (
    <AwardCertificateRoute
      locale={rawLocale === 'en' ? 'en' : 'ar'}
      portal="developer"
      awardId={awardId}
    />
  );
}

export default persistentPortalPage('/developer/badges/awards/[awardId]', Page);
