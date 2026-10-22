import { PortalSection } from '@/components/portal-section';

/** Platform user directory (product portal) — suspend/ops tools live under /site-admin/users. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  void params;
  return <PortalSection portal="platform" segments={['users']} />;
}
