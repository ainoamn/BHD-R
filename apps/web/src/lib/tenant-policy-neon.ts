import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { platformSettings, properties } from '@bhd-r/db';
import { elevatedTx } from '@/lib/elevated-db';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  DEFAULT_TENANT_POLICY,
  readTenantPolicy,
  type MaintenanceWithArrears,
  type TenantPolicy,
} from '@/lib/tenant-policy-shared';

const MANAGER_ROLES = ['organization_owner', 'organization_admin', 'property_manager'];

function settingsKey(orgId: string): string {
  return `tenant_policy:${orgId}`;
}

/** The organization's tenant-request rules; anything unreadable falls back to allowing requests. */
export async function loadTenantPolicy(orgId: string): Promise<TenantPolicy> {
  try {
    const [row] = await elevatedTx((tx) =>
      tx
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, settingsKey(orgId)))
        .limit(1),
    );
    return readTenantPolicy(row?.value);
  } catch (error) {
    console.error('loadTenantPolicy', error);
    return DEFAULT_TENANT_POLICY;
  }
}

/** Who may set the rules: the organization's managers for everything, an owner for their buildings. */
export function tenantPolicyAccess(
  claims: SessionClaims,
): 'organization' | 'own_properties' | null {
  if (!claims.organizationId) return null;
  if (ownerPartyScope(claims))
    return claims.roles.includes('property_owner') ? 'own_properties' : null;
  if (
    claims.roles.some((role) => MANAGER_ROLES.includes(role)) ||
    hasPermission(claims, 'organization.members.write')
  ) {
    return 'organization';
  }
  return null;
}

export type TenantPolicyProperty = {
  id: string;
  nameAr: string;
  nameEn: string | null;
  rule: MaintenanceWithArrears | null;
};

/** The rules with the properties the viewer may set them for. */
export async function loadTenantPolicyForOwner(claims: SessionClaims): Promise<{
  access: 'organization' | 'own_properties';
  policy: TenantPolicy;
  properties: TenantPolicyProperty[];
} | null> {
  const access = tenantPolicyAccess(claims);
  if (!access) return null;
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  const [policy, rows] = await Promise.all([
    loadTenantPolicy(orgId),
    withinViewerTenant(claims, (tx) =>
      tx
        .select({ id: properties.id, nameAr: properties.nameAr, nameEn: properties.nameEn })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, orgId),
            ...(scoped ? [eq(properties.ownerPartyId, scoped)] : []),
          ),
        )
        .orderBy(properties.nameAr)
        .limit(200),
    ),
  ]);
  return {
    access,
    policy,
    properties: rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      rule: policy.properties[row.id.toLowerCase()] ?? null,
    })),
  };
}

/**
 * Saves the rule for the organization (managers only) and for properties. An owner limited to
 * their own buildings changes only those; other properties keep their rules.
 */
export async function saveTenantPolicy(
  claims: SessionClaims,
  input: {
    maintenanceWithArrears?: MaintenanceWithArrears | undefined;
    properties?: Record<string, MaintenanceWithArrears | null> | undefined;
  },
): Promise<TenantPolicy> {
  const access = tenantPolicyAccess(claims);
  if (!access) throw new Error('forbidden');
  if (access === 'own_properties' && input.maintenanceWithArrears) throw new Error('forbidden');
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  const changes = Object.entries(input.properties ?? {}).map(
    ([id, rule]) => [id.toLowerCase(), rule] as const,
  );
  if (changes.length) {
    const allowed = await withinViewerTenant(claims, (tx) =>
      tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, orgId),
            inArray(
              properties.id,
              changes.map(([id]) => id),
            ),
            ...(scoped ? [eq(properties.ownerPartyId, scoped)] : []),
          ),
        ),
    );
    if (allowed.length !== changes.length) throw new Error('forbidden');
  }
  return elevatedTx(async (tx) => {
    const [row] = await tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, settingsKey(orgId)))
      .for('update')
      .limit(1);
    const current = readTenantPolicy(row?.value);
    const nextProperties = { ...current.properties };
    for (const [id, rule] of changes) {
      if (rule) nextProperties[id] = rule;
      else delete nextProperties[id];
    }
    const next: TenantPolicy = {
      maintenanceWithArrears: input.maintenanceWithArrears ?? current.maintenanceWithArrears,
      properties: nextProperties,
    };
    await tx
      .insert(platformSettings)
      .values({
        key: settingsKey(orgId),
        value: next,
        updatedAt: new Date(),
        updatedByUserId: claims.sub,
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: next, updatedAt: new Date(), updatedByUserId: claims.sub },
      });
    return next;
  });
}
