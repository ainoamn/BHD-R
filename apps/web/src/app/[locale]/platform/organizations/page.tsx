import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PortalSection } from '@/components/portal-section';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'المنشآت · إدارة المنصة',
  robots: { index: false, follow: false },
};

export default async function PlatformOrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  return (
    <PlatformAdminFrame locale={locale}>
      <PortalSection portal="platform" segments={['organizations']} />
    </PlatformAdminFrame>
  );
}
