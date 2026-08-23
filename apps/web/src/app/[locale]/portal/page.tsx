import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/viewer';
export default async function PortalRouter({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/login`);
  const priority = ['platform', 'owner', 'developer', 'tenant'] as const;
  const portal = priority.find((role) => viewer.portals.includes(role));
  if (!portal) redirect(`/${locale}/login?error=no_access`);
  redirect(`/${locale}/${portal}`);
}
