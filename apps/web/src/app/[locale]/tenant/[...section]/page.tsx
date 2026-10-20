import { redirect } from 'next/navigation';
import { PortalSection } from '@/components/portal-section';
import { TENANT_SPACE_SECTIONS } from '@/lib/tenant-soft-nav';
import { requirePortal } from '@/lib/viewer';

/**
 * Soft tenant views (contracts, leases, …) are URL anchors for TenantSpaceHost.
 * Other segments (e.g. maintenance) still render via PortalSection.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale: raw, section } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  if (section.length === 1 && TENANT_SPACE_SECTIONS[section[0]!]) {
    await requirePortal(locale, 'tenant');
    return null;
  }
  const viewer = await requirePortal(locale, 'tenant');
  if (!viewer.roles.includes('tenant')) redirect(`/${locale}/tenant`);
  return <PortalSection portal="tenant" segments={section} />;
}
