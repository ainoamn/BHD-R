import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PlatformDiagnosticsPanel } from '@/components/platform/platform-diagnostics-panel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تشخيص النظام · إدارة المنصة',
  robots: { index: false, follow: false },
};

export default async function PlatformDiagnosticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  return (
    <PlatformAdminFrame locale={locale}>
      <PlatformDiagnosticsPanel locale={locale} />
    </PlatformAdminFrame>
  );
}
