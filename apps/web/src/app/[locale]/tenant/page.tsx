import { requirePortal } from '@/lib/viewer';

/**
 * URL anchor only — TenantSpaceHost lives in PortalMainSlot so soft-nav
 * between tenant sections never remounts or flashes.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'tenant');
  return null;
}
