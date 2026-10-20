import { notFound } from 'next/navigation';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { ViewingRequestDesk } from '@/components/viewing-request-desk';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { loadViewingRequestForStaff } from '@/lib/viewing-requests-neon';
import { requirePortal, requirePortalPath } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; viewingId: string }> }) {
  const { locale: rawLocale, viewingId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');
  await requirePortalPath('owner', '/bookings');

  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims) notFound();

  try {
    const viewing = await loadViewingRequestForStaff(claims, viewingId);
    if (!viewing) notFound();
    return <ViewingRequestDesk viewing={viewing} locale={locale} portal="owner" />;
  } catch (error) {
    if (error instanceof Error && error.message === 'forbidden') notFound();
    throw error;
  }
}

export default persistentPortalPage('/owner/bookings/viewings/[viewingId]', Page);
