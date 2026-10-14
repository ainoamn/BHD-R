/**
 * The landlord's rules for tenant requests: whether a tenant who is behind on rent or bills may
 * still send ordinary maintenance requests. Set for the whole organization, with exceptions per
 * property. Urgent requests about the building's or the occupants' safety are always open.
 * Client-safe.
 */

export type MaintenanceWithArrears = 'allow' | 'block';

export type TenantPolicy = {
  maintenanceWithArrears: MaintenanceWithArrears;
  /** Property id → its own rule, overriding the organization's. */
  properties: Record<string, MaintenanceWithArrears>;
};

export const DEFAULT_TENANT_POLICY: TenantPolicy = {
  maintenanceWithArrears: 'allow',
  properties: {},
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readTenantPolicy(value: unknown): TenantPolicy {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rule = (input: unknown): MaintenanceWithArrears | null =>
    input === 'allow' || input === 'block' ? input : null;
  const properties: Record<string, MaintenanceWithArrears> = {};
  if (row.properties && typeof row.properties === 'object') {
    for (const [id, item] of Object.entries(row.properties as Record<string, unknown>)) {
      const parsed = rule(item);
      if (UUID.test(id) && parsed) properties[id.toLowerCase()] = parsed;
    }
  }
  return {
    maintenanceWithArrears: rule(row.maintenanceWithArrears) ?? 'allow',
    properties,
  };
}

/** Whether this property's rule stops ordinary maintenance requests while the tenant owes money. */
export function maintenanceBlockedByPolicy(
  policy: TenantPolicy,
  propertyId: string | null,
): boolean {
  const own = propertyId ? policy.properties[propertyId.toLowerCase()] : undefined;
  return (own ?? policy.maintenanceWithArrears) === 'block';
}
