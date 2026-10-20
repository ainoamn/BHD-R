import { requirePortal, requirePortalPath } from '@/lib/viewer';

/** URL anchor — studio panel is owned by PortalMainSlot for soft-nav. */
async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'developer');
  await requirePortalPath('developer', '/notifications');
  return null;
}

export default Page;
