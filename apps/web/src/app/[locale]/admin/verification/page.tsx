import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إدارة الموقع · توثيق الحسابات',
  robots: { index: false, follow: false, nocache: true },
};

export default async function SiteAdminVerificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requireSiteAdminPage(locale, 'verification');
  return null;
}
