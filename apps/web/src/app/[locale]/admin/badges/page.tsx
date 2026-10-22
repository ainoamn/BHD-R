import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { BadgesCenterBoard } from '@/components/badges/badges-center-board';
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
  await requireSiteAdminPage(locale, null, { path: '/admin/badges' });
  return (
    <div className="site-admin--wide">
        <BadgesCenterBoard locale={locale} portal="admin" />
      </div>
  );
}
