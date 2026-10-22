import { PortalOverview } from '@/components/portal-overview';

/** Thin platform portal for product ops — site/system control lives only under /admin. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PortalOverview locale={locale} portal="platform" />;
}
