import { PortalOverview } from '@/components/portal-overview';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PortalOverview locale={locale} portal="platform" />;
}
