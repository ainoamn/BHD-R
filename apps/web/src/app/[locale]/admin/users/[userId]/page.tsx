import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { UsersAdminDetail } from '@/components/site-admin/users-admin-detail';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ملف مستخدم',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale: raw, userId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'users', {
    path: `/admin/users/${userId}`,
  });
  return <UsersAdminDetail locale={locale} userId={userId} />;
}
