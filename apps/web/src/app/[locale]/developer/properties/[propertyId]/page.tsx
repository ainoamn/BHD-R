import { notFound, redirect } from 'next/navigation';
import { PropertyDetailManager, type ManagedProperty } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadManagedPropertyFromNeon } from '@/lib/load-property-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  if (propertyId === 'new') redirect(`/${locale}/developer/properties/new`);
  const viewer = await requirePortal(locale, 'developer');

  let property: ManagedProperty | null = null;

  if (hasDatabaseUrl() && viewer.organizationId) {
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
      portal="developer"
      staysEnabled={isStaysPlatformEnabled()}
    />
  );
}
