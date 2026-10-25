import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  parties,
  partyIdentityDocuments,
  partyRoles,
  properties,
  representationAuthorities,
} from '@bhd-r/db';
import {
  missingBuildingFields,
  missingOwnerFields,
  type CompletenessBuilding,
  type CompletenessOwner,
} from '@/lib/profile-completeness';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

export type ProfileCompletenessSummary = {
  ownerMissing: number;
  buildingsMissing: number;
  ownerFields: ReturnType<typeof missingOwnerFields>;
  buildings: Array<{
    propertyId: string;
    nameAr: string;
    missing: ReturnType<typeof missingBuildingFields>;
  }>;
};

/** Counts incomplete owner identity and building profiles for portal alerts. */
export async function loadProfileCompletenessSummary(
  claims: SessionClaims,
): Promise<ProfileCompletenessSummary> {
  if (!claims.organizationId) {
    return { ownerMissing: 0, buildingsMissing: 0, ownerFields: [], buildings: [] };
  }
  const orgId = claims.organizationId;
  const ownerPartyId = ownerPartyScope(claims) ?? claims.partyId;

  return withinViewerTenant(claims, async (tx) => {
    let ownerFields: ReturnType<typeof missingOwnerFields> = [];
    if (ownerPartyId) {
      const [party] = await tx
        .select({
          displayName: parties.displayName,
          phone: parties.phone,
          hasNationalId: sql<boolean>`${parties.nationalIdLookupHash} is not null`,
        })
        .from(parties)
        .where(and(eq(parties.id, ownerPartyId), eq(parties.organizationId, orgId)))
        .limit(1);

      const idDocs = await tx
        .select({
          documentType: partyIdentityDocuments.documentType,
          expiresOn: partyIdentityDocuments.expiresOn,
          metadata: partyIdentityDocuments.metadata,
        })
        .from(partyIdentityDocuments)
        .where(
          and(
            eq(partyIdentityDocuments.partyId, ownerPartyId),
            eq(partyIdentityDocuments.organizationId, orgId),
            inArray(partyIdentityDocuments.documentType, ['civil_id', 'passport']),
          ),
        );

      const civil = idDocs.find((row) => row.documentType === 'civil_id');
      const roles = await tx
        .select({ roleKey: partyRoles.roleKey })
        .from(partyRoles)
        .where(
          and(
            eq(partyRoles.partyId, ownerPartyId),
            eq(partyRoles.organizationId, orgId),
            eq(partyRoles.status, 'active'),
          ),
        );
      const isAgent = roles.some((row) => row.roleKey === 'authorized_representative');
      let hasPowerOfAttorney = false;
      let principalCivilIdCopy = false;
      if (isAgent) {
        const [auth] = await tx
          .select({ id: representationAuthorities.id })
          .from(representationAuthorities)
          .where(
            and(
              eq(representationAuthorities.representativePartyId, ownerPartyId),
              eq(representationAuthorities.organizationId, orgId),
              eq(representationAuthorities.status, 'active'),
            ),
          )
          .limit(1);
        hasPowerOfAttorney = Boolean(auth);
        if (auth) {
          const [link] = await tx
            .select({ principalPartyId: representationAuthorities.principalPartyId })
            .from(representationAuthorities)
            .where(eq(representationAuthorities.id, auth.id))
            .limit(1);
          if (link) {
            const [principalDoc] = await tx
              .select({ id: partyIdentityDocuments.id })
              .from(partyIdentityDocuments)
              .where(
                and(
                  eq(partyIdentityDocuments.partyId, link.principalPartyId),
                  eq(partyIdentityDocuments.documentType, 'civil_id'),
                ),
              )
              .limit(1);
            principalCivilIdCopy = Boolean(principalDoc);
          }
        }
      }

      const meta = (civil?.metadata ?? {}) as { hasCopy?: boolean };
      const owner: CompletenessOwner = {
        displayName: party?.displayName ?? undefined,
        civilId: party?.hasNationalId ? '••••' : undefined,
        phone: party?.phone ?? undefined,
        civilIdCopy: Boolean(civil) || meta.hasCopy === true,
        civilIdExpiresOn: civil?.expiresOn ?? undefined,
        isAgent,
        hasPowerOfAttorney,
        principalCivilIdCopy,
      };
      ownerFields = missingOwnerFields(owner);
    }

    const propertyFilter = ownerPartyId
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerPartyId, ownerPartyId))
      : eq(properties.organizationId, orgId);

    const propertyRows = await tx
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        nameEn: properties.nameEn,
        category: properties.category,
        governorate: addresses.governorate,
        wilayat: addresses.wilayat,
        city: addresses.city,
        hasLocation: sql<boolean>`${addresses.location} is not null`,
      })
      .from(properties)
      .innerJoin(addresses, eq(addresses.id, properties.addressId))
      .where(and(propertyFilter, inArray(properties.status, ['active', 'draft'])))
      .limit(80);

    const buildings: ProfileCompletenessSummary['buildings'] = [];
    for (const row of propertyRows) {
      const building: CompletenessBuilding = {
        nameAr: row.nameAr ?? undefined,
        nameEn: row.nameEn ?? undefined,
        category: row.category ?? undefined,
        governorate: row.governorate ?? undefined,
        wilayat: row.wilayat ?? undefined,
        city: row.city ?? undefined,
        // Location point stands in for a maps pin until a URL is stored separately.
        mapsUrl: row.hasLocation ? 'geo' : undefined,
      };
      const missing = missingBuildingFields(building);
      if (missing.length) {
        buildings.push({ propertyId: row.id, nameAr: row.nameAr, missing });
      }
    }

    return {
      ownerMissing: ownerFields.length,
      buildingsMissing: buildings.length,
      ownerFields,
      buildings,
    };
  });
}
