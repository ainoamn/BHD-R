import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PlatformSecurityPanel } from '@/components/platform/platform-security-panel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الأمن والتدقيق · إدارة المنصة',
  robots: { index: false, follow: false },
};

export default async function PlatformSecurityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  return (
    <PlatformAdminFrame locale={locale}>
      <PlatformSecurityPanel locale={locale} />
    </PlatformAdminFrame>
  );
}
