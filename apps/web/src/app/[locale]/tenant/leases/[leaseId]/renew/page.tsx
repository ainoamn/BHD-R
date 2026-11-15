import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LeaseRenewalForm } from '@/components/lease-renewal-form';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadLeaseRenewalContext } from '@/lib/lease-renewal-neon';
import { readClaims } from '@/lib/portal-ops-data';
import { tenantClaimsForLease } from '@/lib/tenancy-neon';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; leaseId: string }>;
}) {
  const { locale: rawLocale, leaseId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  await requirePortal(locale, 'tenant');

  if (!hasDatabaseUrl() || !/^[0-9a-f-]{36}$/i.test(leaseId)) notFound();
  const claims = await readClaims();
  if (!claims) notFound();

  const tenantClaims = await tenantClaimsForLease(claims, leaseId);
  if (!tenantClaims) notFound();

  const context = await loadLeaseRenewalContext(tenantClaims, leaseId);
  if (!context) notFound();

  const pending = context.pendingRenewal;
  if (pending && (pending.status === 'sent' || pending.status === 'partially_signed')) {
    redirect(`/${locale}/tenant/contracts/${pending.id}`);
  }

  return <LeaseRenewalForm context={context} locale={locale} portal="tenant" />;
}
