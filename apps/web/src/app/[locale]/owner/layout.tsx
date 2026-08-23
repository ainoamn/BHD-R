import { PortalShell } from '@/components/portal-shell';
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <PortalShell locale={locale} portal="owner">
      {children}
    </PortalShell>
  );
}
