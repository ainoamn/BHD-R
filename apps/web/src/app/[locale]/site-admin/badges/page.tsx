import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { BadgesCenterBoard } from '@/components/badges/badges-center-board';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · الشارات',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminBadgesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/site-admin/badges' });
  return (
    <>
      <SiteAdminNav access={access} current="badges" locale={locale} />
      <div className="site-admin--wide" style={{ margin: '0 auto', padding: '1rem' }}>
        <BadgesCenterBoard locale={locale} portal="site-admin" />
      </div>
    </>
  );
}
