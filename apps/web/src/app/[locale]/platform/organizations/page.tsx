import { PortalSection } from '@/components/portal-section';

/** Platform org list (product portal) — not the site-owner console. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  void params;
  return <PortalSection portal="platform" segments={['organizations']} />;
}
