import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PortalSpaceChooser } from '@/components/portal-space-chooser';
import {
  managerPortalOf,
  needsPortalSpaceChooser,
  parsePortalSpacePref,
  PORTAL_SPACE_COOKIE,
} from '@/lib/portal-space-pref';
import { privatePortalRobots } from '@/lib/seo';
import { getViewer } from '@/lib/viewer';
import type { PortalRole } from '@/lib/types';

export const metadata: Metadata = {
  robots: privatePortalRobots,
  title: 'مساحتي | Workspace',
};

export default async function PortalRouter({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('portal');
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/login`);

  const portals = viewer.portals;
  if (!portals.length) redirect(`/${locale}/login?error=no_access`);

  const loc = locale === 'en' ? 'en' : 'ar';
  const preferred = parsePortalSpacePref((await cookies()).get(PORTAL_SPACE_COOKIE)?.value);

  if (needsPortalSpaceChooser(portals)) {
    return (
      <PortalSpaceChooser
        locale={loc}
        portals={portals}
        preferred={preferred && portals.includes(preferred) ? preferred : null}
      />
    );
  }

  const manager = managerPortalOf(portals);
  const fallbackPriority: PortalRole[] = ['platform', 'owner', 'developer', 'tenant'];
  const portal =
    (preferred && portals.includes(preferred) ? preferred : null) ??
    manager ??
    fallbackPriority.find((role) => portals.includes(role));
  if (!portal) redirect(`/${locale}/login?error=no_access`);
  redirect(`/${locale}/${portal}`);
}
