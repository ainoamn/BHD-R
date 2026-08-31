import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import { PropertyDetailManager, type ManagedProperty } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import { ensurePublishedListingsMatchFlags } from '@/lib/create-property-neon';
import { loadManagedPropertyFromNeon } from '@/lib/load-property-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { requirePortal } from '@/lib/viewer';

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  if (propertyId === 'new') redirect(`/${locale}/owner/properties/new`);
  const viewer = await requirePortal(locale, 'owner');

  let property: ManagedProperty | null = null;

  // Prefer Neon for complete profile/maps/gallery when configured.
  if (hasDatabaseUrl() && viewer.organizationId) {
    const token = (await cookies()).get('bhd_r_session')?.value;
    if (token) {
      try {
        const claims = await verifySessionToken(token, sessionSecret());
        await ensurePublishedListingsMatchFlags(claims, propertyId);
      } catch {
        /* ignore heal failures */
      }
    }
    property = await loadManagedPropertyFromNeon(viewer.organizationId, propertyId, {
      userId: viewer.id,
      partyId: viewer.partyId,
    }).catch(() => null);
  }

  if (!property) {
    try {
      property = await apiFetch<ManagedProperty>(
        `/v1/portfolio/properties/${encodeURIComponent(propertyId)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
    }
  }

  if (!property) notFound();
  return (
    <PropertyDetailManager
      property={property}
      locale={locale}
      portal="owner"
      staysEnabled={isStaysPlatformEnabled()}
    />
  );
}
