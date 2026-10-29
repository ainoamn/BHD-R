import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal-shell';
import { privatePortalRobots } from '@/lib/seo';
import '../../portal-adaptive.css';
import '../../badges-verification.css';

export const metadata: Metadata = {
  robots: privatePortalRobots,
};

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <PortalShell locale={locale} portal="platform">
      {children}
    </PortalShell>
  );
}
