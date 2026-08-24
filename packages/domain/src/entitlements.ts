export type EntitlementMetric = 'properties' | 'units' | 'representatives' | 'storageBytes';

export interface PlanEntitlements {
  key: string;
  properties: number;
  units: number;
  representatives: number;
  storageBytes: number;
}

export const PLAN_ENTITLEMENTS: Record<string, PlanEntitlements> = {
  starter: {
    key: 'starter',
    properties: 5,
    units: 25,
    representatives: 2,
    storageBytes: 5 * 1024 ** 3,
  },
  growth: {
    key: 'growth',
    properties: 50,
    units: 500,
    representatives: 10,
    storageBytes: 50 * 1024 ** 3,
  },
  enterprise: {
    key: 'enterprise',
    properties: 10_000,
    units: 100_000,
    representatives: 100,
    storageBytes: 500 * 1024 ** 3,
  },
};

export function entitlementsForPlan(planKey: string | null | undefined): PlanEntitlements {
  const key = (planKey ?? 'starter').trim().toLowerCase();
  return PLAN_ENTITLEMENTS[key] ?? PLAN_ENTITLEMENTS.starter!;
}

export function assertWithinEntitlement(input: {
  planKey: string | null | undefined;
  metric: EntitlementMetric;
  current: number;
  requested?: number;
}): { ok: true; limit: number; next: number } | { ok: false; limit: number; next: number } {
  const plan = entitlementsForPlan(input.planKey);
  const requested = input.requested ?? 1;
  const next = input.current + requested;
  const limit = plan[input.metric];
  if (next > limit) return { ok: false, limit, next };
  return { ok: true, limit, next };
}
