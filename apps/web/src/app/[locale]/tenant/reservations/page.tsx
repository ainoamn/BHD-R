import { requirePortal } from '@/lib/viewer';

/**
 * URL anchor only — bookings view is rendered by TenantSpaceHost in PortalMainSlot.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'tenant');
  return null;
}
