import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminNav } from '@/components/site-admin/site-admin-nav';
import { UsersAdmin } from '@/components/site-admin/users-admin';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إدارة الموقع · المستخدمون',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, 'users');
  return (
    <>
      <SiteAdminNav access={access} current="users" locale={locale} />
      <UsersAdmin locale={locale} />
    </>
  );
}
