import { requirePortal, requirePortalPath } from '@/lib/viewer';

/**
 * URL anchor only — NotificationTemplatesStudio lives in PortalMainSlot so soft-nav
 * between ops and notifications never remounts or flashes.
 */
async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  await requirePortalPath('owner', '/notifications');
  return null;
}

export default Page;
