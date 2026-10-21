import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { UsersAdmin } from '@/components/site-admin/users-admin';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'المستخدمون · إدارة المنصة',
  robots: { index: false, follow: false },
};

/** User suspend/restore — same tooling as /site-admin/users. */
export default async function PlatformUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'users', { path: '/platform/users' });
  return (
    <PlatformAdminFrame locale={locale}>
      <UsersAdmin locale={locale} />
    </PlatformAdminFrame>
  );
}
