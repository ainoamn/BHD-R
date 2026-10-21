import { setRequestLocale } from 'next-intl/server';
import { PlatformAdminFrame } from '@/components/platform/platform-admin-frame';
import { PlatformAdminOverview } from '@/components/platform/platform-admin-overview';

export const dynamic = 'force-dynamic';

/** Platform administration landing — diagnostics pulse and section shortcuts. */
export default async function PlatformAdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  return (
    <PlatformAdminFrame locale={locale}>
      <PlatformAdminOverview locale={locale} />
    </PlatformAdminFrame>
  );
}
