import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { notFound, redirect } from 'next/navigation';
import { PropertyDetailManager, type ManagedProperty } from '@/components/property-detail-manager';
import { subjectBadgeChips, type BadgeChip } from '@/lib/badge-chips-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadManagedPropertyFromNeon } from '@/lib/load-property-neon';
import {
  emptyPropertyOpsPulse,
  loadPropertyOpsPulseOnNeon,
  type PropertyOpsPulse,
} from '@/lib/property-ops-pulse-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; propertyId: string }> }) {
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

  let opsPulse: PropertyOpsPulse = emptyPropertyOpsPulse();
  let badges: BadgeChip[] = [];
  if (hasDatabaseUrl() && viewer.organizationId) {
    [opsPulse, badges] = await Promise.all([
      loadPropertyOpsPulseOnNeon(viewer.organizationId, propertyId, {
        userId: viewer.id,
        partyId: viewer.partyId,
      }).catch(() => emptyPropertyOpsPulse()),
      subjectBadgeChips('property', property.id, viewer.organizationId),
    ]);
  }

  return (
    <PropertyDetailManager
      property={property}
      locale={locale}
      portal="developer"
      staysEnabled={isStaysPlatformEnabled()}
      opsPulse={opsPulse}
      badges={badges}
    />
  );
}

export default persistentPortalPage('/developer/properties/[propertyId]', Page);
