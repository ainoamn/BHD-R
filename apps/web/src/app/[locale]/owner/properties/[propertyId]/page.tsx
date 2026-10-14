import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import { PropertyDetailManager, type ManagedProperty } from '@/components/property-detail-manager';
import type { PropertyHubAccess } from '@/components/property-manage-hub';
import { subjectBadgeChips } from '@/lib/badge-chips-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { canOpenPortalPath, holdsSectionPermission, scopedOwnerParty } from '@/lib/portal-access';
import { PROPERTY_RECORD_SECTIONS } from '@/lib/property-records-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { ensurePublishedListingsMatchFlags } from '@/lib/create-property-neon';
import { loadManagedPropertyFromNeon } from '@/lib/load-property-neon';
import {
  emptyPropertyOpsPulse,
  loadPropertyOpsPulseOnNeon,
  type PropertyOpsPulse,
} from '@/lib/property-ops-pulse-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { loadPropertySaleDecisions, type SaleDecisionUnit } from '@/lib/unit-sale-decision-neon';
import { requirePortal } from '@/lib/viewer';
import { UnitSaleDecisionPrompt } from '@/components/unit-sale-decision-prompt';
import { PropertyBadgesPanel } from '@/components/badges/subject-badges-panel';

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
  searchParams: Promise<{ unit?: string | string[] }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const query = await searchParams;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  if (propertyId === 'new') redirect(`/${locale}/owner/properties/new`);
  const viewer = await requirePortal(locale, 'owner');
  // A building owner opens only their own properties, and never through the unscoped API.
  const ownerPartyId = scopedOwnerParty(viewer);

  let property: ManagedProperty | null = null;
  const neonOrgId = hasDatabaseUrl() ? viewer.organizationId : null;
  const loadPulse = (): Promise<PropertyOpsPulse> =>
    neonOrgId
      ? loadPropertyOpsPulseOnNeon(neonOrgId, propertyId, {
          userId: viewer.id,
          partyId: viewer.partyId,
        }).catch(() => emptyPropertyOpsPulse())
      : Promise.resolve(emptyPropertyOpsPulse());
  const opsPulsePromise = ownerPartyId ? null : loadPulse();

  let saleDecisions: SaleDecisionUnit[] = [];
  // Prefer Neon for complete profile/maps/gallery when configured.
  if (neonOrgId) {
    const token = (await cookies()).get('bhd_r_session')?.value;
    if (token) {
      try {
        const claims = await verifySessionToken(token, sessionSecret());
        const decisions = loadPropertySaleDecisions(claims, propertyId).catch(
          () => [] as SaleDecisionUnit[],
        );
        if (!ownerPartyId) await ensurePublishedListingsMatchFlags(claims, propertyId);
        saleDecisions = await decisions;
      } catch {
        /* ignore heal failures */
      }
    }
    property = await loadManagedPropertyFromNeon(neonOrgId, propertyId, {
      userId: viewer.id,
      partyId: viewer.partyId,
      ownerPartyId,
    }).catch(() => null);
  }

  if (!property && !ownerPartyId) {
    try {
      property = await apiFetch<ManagedProperty>(
        `/v1/portfolio/properties/${encodeURIComponent(propertyId)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
    }
  }

  if (!property) notFound();

  const [opsPulse, badges] = await Promise.all([
    opsPulsePromise ?? loadPulse(),
    neonOrgId ? subjectBadgeChips('property', property.id, neonOrgId) : [],
  ]);

  const can = (permission: string) => viewer.permissions.includes(permission);
  const hubAccess: PropertyHubAccess = {
    sections: PROPERTY_RECORD_SECTIONS.filter((section) => holdsSectionPermission(viewer, section)),
    edit: canOpenPortalPath(viewer, 'owner', '/properties/edit'),
    archive: !ownerPartyId && (can('property.update') || can('property.archive')),
    stays: canOpenPortalPath(viewer, 'owner', '/stays/setup'),
    terms: canOpenPortalPath(viewer, 'owner', '/properties/terms'),
    finance: can('payment.read') || can('invoice.read') || can('accounting.read'),
  };

  const unitQuery = typeof query.unit === 'string' ? query.unit : query.unit?.[0];
  const focusUnitId =
    unitQuery && property.units.some((unit) => unit.id === unitQuery || unit.code === unitQuery)
      ? property.units.find((unit) => unit.id === unitQuery || unit.code === unitQuery)?.id
      : undefined;

  return (
    <>
      {saleDecisions.length ? (
        <UnitSaleDecisionPrompt units={saleDecisions} locale={locale} />
      ) : null}
      <PropertyDetailManager
        property={property}
        locale={locale}
        portal="owner"
        staysEnabled={isStaysPlatformEnabled()}
        opsPulse={opsPulse}
        hubAccess={hubAccess}
        badges={badges}
        {...(focusUnitId ? { focusUnitId } : {})}
      />
      {!ownerPartyId && neonOrgId ? (
        <PropertyBadgesPanel propertyId={property.id} locale={locale} portal="owner" />
      ) : null}
    </>
  );
}

export default persistentPortalPage('/owner/properties/[propertyId]', Page);
