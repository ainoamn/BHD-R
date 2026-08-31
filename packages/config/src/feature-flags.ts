/**
 * BHD R Stays feature flags — closed by default at every scope.
 * Phase 0: definitions + resolution only. No public routes or Nest modules yet.
 */

export type StaysFlagScope = {
  /** Platform kill-switch (env STAYS_PLATFORM_ENABLED). */
  platformEnabled?: boolean;
  /** Organization allow-list (env STAYS_ORG_ALLOWLIST comma UUIDs) or future DB. */
  organizationId?: string | null;
  organizationEnabled?: boolean;
  /** Property / unit overrides once stay_profiles exist (Phase 1+). */
  propertyEnabled?: boolean;
  unitEnabled?: boolean;
};

export type StaysFlagResolution = {
  /** True only when every applicable layer allows stays. */
  enabled: boolean;
  platform: boolean;
  organization: boolean;
  property: boolean;
  unit: boolean;
  reason: 'platform_off' | 'organization_off' | 'property_off' | 'unit_off' | 'enabled';
};

function parseBoolFlag(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null || raw.trim() === '') return defaultValue;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Read platform + org allow-list from process env (defaults: all off). */
export function readStaysFlagsFromEnv(source: NodeJS.ProcessEnv = process.env): {
  platformEnabled: boolean;
  organizationAllowlist: Set<string>;
} {
  return {
    platformEnabled: parseBoolFlag(source.STAYS_PLATFORM_ENABLED, false),
    organizationAllowlist: parseAllowlist(source.STAYS_ORG_ALLOWLIST),
  };
}

/**
 * Resolve whether Stays is active for a given scope.
 * Missing org/property/unit layers default to **false** (fail-closed).
 */
export function resolveStaysEnabled(scope: StaysFlagScope = {}): StaysFlagResolution {
  const platform = scope.platformEnabled === true;
  if (!platform) {
    return {
      enabled: false,
      platform: false,
      organization: false,
      property: false,
      unit: false,
      reason: 'platform_off',
    };
  }

  const organization = scope.organizationEnabled === true;
  if (!organization) {
    return {
      enabled: false,
      platform: true,
      organization: false,
      property: false,
      unit: false,
      reason: 'organization_off',
    };
  }

  const property = scope.propertyEnabled === true;
  if (!property) {
    return {
      enabled: false,
      platform: true,
      organization: true,
      property: false,
      unit: false,
      reason: 'property_off',
    };
  }

  const unit = scope.unitEnabled === true;
  if (!unit) {
    return {
      enabled: false,
      platform: true,
      organization: true,
      property: true,
      unit: false,
      reason: 'unit_off',
    };
  }

  return {
    enabled: true,
    platform: true,
    organization: true,
    property: true,
    unit: true,
    reason: 'enabled',
  };
}

/** Convenience: env platform + allowlist org, property/unit still require explicit true. */
export function resolveStaysEnabledFromEnv(
  input: {
    organizationId?: string | null;
    propertyEnabled?: boolean;
    unitEnabled?: boolean;
  } = {},
  source: NodeJS.ProcessEnv = process.env,
): StaysFlagResolution {
  const fromEnv = readStaysFlagsFromEnv(source);
  const orgId = input.organizationId?.trim().toLowerCase() ?? '';
  const organizationEnabled =
    Boolean(orgId) &&
    (fromEnv.organizationAllowlist.has('*') || fromEnv.organizationAllowlist.has(orgId));

  return resolveStaysEnabled({
    platformEnabled: fromEnv.platformEnabled,
    organizationId: input.organizationId ?? null,
    organizationEnabled,
    ...(input.propertyEnabled !== undefined ? { propertyEnabled: input.propertyEnabled } : {}),
    ...(input.unitEnabled !== undefined ? { unitEnabled: input.unitEnabled } : {}),
  });
}

/**
 * Public marketing surface (`/[locale]/stays`, homepage stay tab).
 * - With a resolution: requires full layered enablement.
 * - Env-only (no resolution): platform kill-switch (`STAYS_PLATFORM_ENABLED`).
 * Defaults off; org/property/unit still gate bookings and ops APIs separately.
 */
export function staysPublicSurfaceEnabled(resolution?: StaysFlagResolution): boolean {
  if (resolution) return resolution.enabled;
  return readStaysFlagsFromEnv().platformEnabled;
}
