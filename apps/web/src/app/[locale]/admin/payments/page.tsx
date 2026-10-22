import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireSiteAdminPage } from '@/lib/site-admin-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تحكم الموقع · بوابات الدفع',
  robots: { index: false, follow: false, nocache: true },
};

/** Soft-nav host owns the desk — this route is the URL + auth anchor. */
export default async function SiteAdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const access = await requireSiteAdminPage(locale, null, { path: '/admin/payments' });
  if (!access.root) redirect(`/${locale}/admin`);
  return null;
}
