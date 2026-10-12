import { redirect } from 'next/navigation';
import { PortalSection } from '@/components/portal-section';
import { TENANT_SPACE_SECTIONS, TenantSpace } from '@/components/tenant-space';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; section: string[] }>;
}) {
  const { locale, section } = await params;
  const view = section.length === 1 ? TENANT_SPACE_SECTIONS[section[0]!] : undefined;
  if (view) return <TenantSpace locale={locale} view={view} />;
  // Maintenance and requests still read the session organization: only for tenant members.
  const viewer = await requirePortal(locale, 'tenant');
  if (!viewer.roles.includes('tenant')) redirect(`/${locale === 'en' ? 'en' : 'ar'}/tenant`);
  return <PortalSection portal="tenant" segments={section} />;
}
