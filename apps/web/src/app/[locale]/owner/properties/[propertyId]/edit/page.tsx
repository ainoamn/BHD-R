import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { PropertyWizard } from '@/components/property-wizard';
import type { ManagedProperty } from '@/components/property-detail-manager';
import { ensureOwnerPartyId, hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadManagedPropertyFromNeon } from '@/lib/load-property-neon';
import { listOwnerPartyOptions } from '@/lib/owner-parties';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  if (propertyId === 'new') redirect(`/${locale}/owner/properties/new`);
  const viewer = await requirePortal(locale, 'owner');
  const t = await getTranslations();
  if (!viewer.organizationId) return <EmptyState title={t('Portal.noData')} />;

  let property: ManagedProperty | null = null;
  try {
    property = await apiFetch<ManagedProperty>(
      `/v1/portfolio/properties/${encodeURIComponent(propertyId)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
  }

  if (!property && hasDatabaseUrl()) {
    property = await loadManagedPropertyFromNeon(viewer.organizationId, propertyId, {
      userId: viewer.id,
      partyId: viewer.partyId,
    }).catch(() => null);
  }

  if (!property) notFound();

  const partyId = await ensureOwnerPartyId({
    userId: viewer.id,
    organizationId: viewer.organizationId,
    displayName: viewer.displayName,
    email: viewer.email?.trim() || `${viewer.id}@identity.bhd-om.local`,
    partyId: viewer.partyId,
  });
  const ownerPartyOptions = await listOwnerPartyOptions(viewer.organizationId).catch(() => [
    { id: partyId, displayName: viewer.displayName, type: 'person' },
  ]);

  const currentOwner =
    property.ownership.find((row) => !row.endsOn)?.partyId ??
    property.ownership[0]?.partyId ??
    partyId;

  return (
    <PropertyWizard
      ownerPartyId={currentOwner}
      ownerPartyOptions={ownerPartyOptions}
      portal="owner"
      mode="edit"
      propertyId={property.id}
      initialProperty={property}
    />
  );
}
