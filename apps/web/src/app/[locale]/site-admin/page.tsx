import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { SiteAdminPanel } from '@/components/site-admin/site-admin-panel';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { isSiteAdmin } from '@/lib/stay-deposit-claims-neon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إدارة الموقع · شكاوى التأمين',
  robots: { index: false, follow: false },
};

/** Site administration: guests' deposit complaints, and who receives them. */
export default async function SiteAdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/site-admin`)}`);
  if (!(await isSiteAdmin(claims).catch(() => false))) notFound();
  return <SiteAdminPanel locale={locale} />;
}
