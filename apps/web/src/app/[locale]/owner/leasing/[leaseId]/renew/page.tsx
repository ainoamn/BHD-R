import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LeaseRenewalForm } from '@/components/lease-renewal-form';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadLeaseRenewalContext } from '@/lib/lease-renewal-neon';
import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { readClaims } from '@/lib/portal-ops-data';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; leaseId: string }> }) {
  const { locale: rawLocale, leaseId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requirePortal(locale, 'owner');

  if (!hasDatabaseUrl()) notFound();
  const claims = await readClaims();
  if (!claims) notFound();

  const context = await loadLeaseRenewalContext(claims, leaseId);
  if (!context) notFound();

  return <LeaseRenewalForm context={context} locale={locale} portal="owner" />;
}

export default persistentPortalPage('/owner/leasing/[leaseId]/renew', Page);
