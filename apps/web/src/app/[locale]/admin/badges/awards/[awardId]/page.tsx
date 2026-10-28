import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { AwardCertificateRoute } from '@/components/badges/award-certificate-route';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · شهادة شارة',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminBadgeAwardPage({
  params,
}: {
  params: Promise<{ locale: string; awardId: string }>;
}) {
  const { locale: raw, awardId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, null, {
    path: `/admin/badges/awards/${awardId}`,
  });
  return (
    <div className="site-admin--wide">
      <AwardCertificateRoute locale={locale} portal="admin" awardId={awardId} />
    </div>
  );
}
