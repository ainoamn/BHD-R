import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { memberships, parties, properties, users, type Database } from '@bhd-r/db';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { isInternationalPhone, toInternationalPhone } from '@/lib/world-countries';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ViewingContactCandidate = {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: string;
};

export type PropertyViewingContact = {
  propertyId: string;
  propertyNameAr: string;
  contactUserId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  candidates: ViewingContactCandidate[];
};

const STAFF_ROLES = [
  'building_guard',
  'property_manager',
  'admin_staff',
  'organization_admin',
  'organization_owner',
  'maintenance_agent',
] as const;

function fail(code: string): never {
  throw new Error(code);
}

async function staffPartyPhone(
  tx: Pick<Tx, 'select'>,
  orgId: string,
  userId: string,
): Promise<{ partyId: string | null; phone: string | null }> {
  const rows = await tx
    .select({ partyId: memberships.partyId, phone: parties.phone })
    .from(memberships)
    .leftJoin(
      parties,
      and(eq(parties.id, memberships.partyId), eq(parties.organizationId, orgId)),
    )
    .where(
      and(
        eq(memberships.organizationId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(8);
  for (const row of rows) {
    const phone = row.phone?.trim();
    if (phone) return { partyId: row.partyId, phone };
  }
  return { partyId: rows[0]?.partyId ?? null, phone: null };
}

export async function loadPropertyViewingContact(
  claims: SessionClaims,
  propertyId: string,
): Promise<PropertyViewingContact | null> {
  if (!hasPermission(claims, 'property.read')) fail('forbidden');
  if (!claims.organizationId) fail('forbidden');
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    const propertyRows = await tx
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        contactUserId: properties.viewingContactUserId,
      })
      .from(properties)
      .where(
        and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    const property = propertyRows[0];
    if (!property) return null;

    const activeMembers = await tx
      .select({
        userId: memberships.userId,
        roleKey: memberships.roleKey,
        name: users.displayName,
        email: users.email,
        phone: parties.phone,
        disabledAt: users.disabledAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(
        parties,
        and(
          eq(parties.id, memberships.partyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      )
      .where(
        and(
          eq(memberships.organizationId, claims.organizationId!),
          eq(memberships.status, 'active'),
          inArray(memberships.roleKey, [...STAFF_ROLES]),
          isNull(users.disabledAt),
        ),
      );

    const byUser = new Map<string, ViewingContactCandidate>();
    for (const row of activeMembers) {
      const existing = byUser.get(row.userId);
      const phone = row.phone?.trim() || null;
      const preferGuard = row.roleKey === 'building_guard';
      if (!existing || preferGuard) {
        byUser.set(row.userId, {
          userId: row.userId,
          name: row.name,
          email: row.email,
          phone: phone ?? existing?.phone ?? null,
          roleKey: preferGuard ? row.roleKey : (existing?.roleKey ?? row.roleKey),
        });
      } else if (!existing.phone && phone) {
        byUser.set(row.userId, { ...existing, phone });
      }
    }

    const candidates = [...byUser.values()].sort((a, b) => {
      const rank = (role: string) => (role === 'building_guard' ? 0 : 1);
      return rank(a.roleKey) - rank(b.roleKey) || a.name.localeCompare(b.name, 'ar');
    });

    let contactName: string | null = null;
    let contactEmail: string | null = null;
    let contactPhone: string | null = null;
    if (property.contactUserId) {
      const match = candidates.find((c) => c.userId === property.contactUserId);
      if (match) {
        contactName = match.name;
        contactEmail = match.email;
        contactPhone = match.phone;
      } else {
        const rows = await tx
          .select({ name: users.displayName, email: users.email })
          .from(users)
          .where(eq(users.id, property.contactUserId))
          .limit(1);
        contactName = rows[0]?.name ?? null;
        contactEmail = rows[0]?.email ?? null;
        const partyPhone = await staffPartyPhone(tx, claims.organizationId!, property.contactUserId);
        contactPhone = partyPhone.phone;
      }
    }

    return {
      propertyId: property.id,
      propertyNameAr: property.nameAr,
      contactUserId: property.contactUserId,
      contactName,
      contactEmail,
      contactPhone,
      candidates,
    };
  });
}

export async function setPropertyViewingContact(
  claims: SessionClaims,
  propertyId: string,
  contactUserId: string | null,
  phoneInput?: string | null,
): Promise<PropertyViewingContact> {
  if (!hasPermission(claims, 'property.update') && !hasPermission(claims, 'viewing.manage')) {
    fail('forbidden');
  }
  if (!claims.organizationId) fail('forbidden');
  const ownerPartyId = ownerPartyScope(claims);
  const phone =
    phoneInput == null || phoneInput.trim() === ''
      ? null
      : toInternationalPhone(phoneInput.trim());
  if (phone && !isInternationalPhone(phone)) fail('viewing_contact_phone_invalid');

  await withinViewerTenant(claims, async (tx) => {
    const propertyRows = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, claims.organizationId!),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!propertyRows[0]) fail('not_found');

    if (contactUserId) {
      const member = await tx
        .select({ userId: memberships.userId, partyId: memberships.partyId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, claims.organizationId!),
            eq(memberships.userId, contactUserId),
            eq(memberships.status, 'active'),
            inArray(memberships.roleKey, [...STAFF_ROLES]),
          ),
        )
        .limit(1);
      if (!member[0]) fail('viewing_contact_invalid');

      const existing = await staffPartyPhone(tx, claims.organizationId!, contactUserId);
      const nextPhone = phone ?? existing.phone;
      if (!nextPhone) fail('viewing_contact_phone_required');

      if (phone) {
        if (!existing.partyId) fail('viewing_contact_phone_required');
        await tx
          .update(parties)
          .set({ phone, updatedAt: new Date() })
          .where(
            and(eq(parties.id, existing.partyId), eq(parties.organizationId, claims.organizationId!)),
          );
      }
    }

    await tx
      .update(properties)
      .set({ viewingContactUserId: contactUserId, updatedAt: new Date() })
      .where(eq(properties.id, propertyId));
  });

  const detail = await loadPropertyViewingContact(claims, propertyId);
  if (!detail) fail('not_found');
  if (detail.contactUserId && !detail.contactPhone) fail('viewing_contact_phone_required');
  return detail;
}
