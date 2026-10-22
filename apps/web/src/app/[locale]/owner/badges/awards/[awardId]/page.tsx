import { AwardCertificateRoute } from '@/components/badges/award-certificate-route';
import { persistentPortalPage } from '@/lib/persistent-portal-page';

/** Certificate view stays on the org portal; badge catalogue lives under /admin/badges. */
async function Page({ params }: { params: Promise<{ locale: string; awardId: string }> }) {
  const { locale: rawLocale, awardId } = await params;
  return (
    <AwardCertificateRoute
      locale={rawLocale === 'en' ? 'en' : 'ar'}
      portal="owner"
      awardId={awardId}
    />
  );
}

export default persistentPortalPage('/owner/badges/awards/[awardId]', Page);
