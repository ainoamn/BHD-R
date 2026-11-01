import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PropertyAdminInspect } from '@/components/site-admin/property-admin-inspect';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'عقار · اطّلاع إداري',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminPropertyPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: raw, propertyId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'users', {
    path: `/admin/properties/${propertyId}`,
  });
  return <PropertyAdminInspect locale={locale} propertyId={propertyId} />;
}
