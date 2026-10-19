import { notFound } from 'next/navigation';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { ViewingRequestDesk } from '@/components/viewing-request-desk';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { loadViewingRequestForStaff } from '@/lib/viewing-requests-neon';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; viewingId: string }> }) {
  const { locale: rawLocale, viewingId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');

  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims) notFound();

  const viewing = await loadViewingRequestForStaff(claims, viewingId).catch(() => null);
  if (!viewing) notFound();

  return <ViewingRequestDesk viewing={viewing} locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/bookings/viewings/[viewingId]', Page);
