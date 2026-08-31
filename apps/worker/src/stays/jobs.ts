/**
 * Phase 6–8 worker foundations for BHD R Stays.
 * Jobs are registered only when STAYS_PLATFORM_ENABLED is true (caller must gate).
 */

export const STAY_JOB_NAMES = [
  'stay-hold-expirer',
  'stay-inventory-projector',
  'stay-housekeeping',
  'stay-notifications',
] as const;

export type StayJobName = (typeof STAY_JOB_NAMES)[number];

export async function runStayHoldExpirer(deps: {
  releaseExpiredHolds: () => Promise<number>;
}): Promise<{ released: number }> {
  const released = await deps.releaseExpiredHolds();
  return { released };
}

export async function runStayInventoryProjector(deps: {
  rebuildUnitDays: (unitId: string) => Promise<number>;
  unitId: string;
}): Promise<{ days: number }> {
  const days = await deps.rebuildUnitDays(deps.unitId);
  return { days };
}

/** Phase 8 stub — iCal/OTA sync must block SSRF (no private IPs, re-check redirects). */
export function staysChannelSyncBlockedReason(): string {
  return 'channel_sync_not_enabled_until_phase_8_security_gates';
}
