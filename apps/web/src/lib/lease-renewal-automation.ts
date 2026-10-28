/**
 * Organization / per-contract rules for electronic lease renewal:
 * when to offer a renewal, how long the next term is, and whether a
 * tenant-shortened term can be auto-approved.
 */

export const RENEWAL_TERM_PRESETS = [1, 3, 6, 12, 24] as const;
export type RenewalTermPreset = (typeof RENEWAL_TERM_PRESETS)[number];

export type LeaseRenewalAutomationPolicy = {
  /** When true, eligible leases get an addendum without owner click. */
  enabled: boolean;
  /** Days before endsOn to open the renewal (default 90 ≈ 3 months). */
  leadDays: number;
  /**
   * Next term length in months. `null` = same duration as the current lease.
   * Typical presets: 1 / 6 / 12.
   */
  termMonths: number | null;
  /** Shortest term the tenant may propose (months). */
  minTermMonths: number;
  /** Auto-accept a shorter term when it still meets minTermMonths. */
  autoApproveShorterTerm: boolean;
};

/** Optional overrides stored on the signed parent contract payload. */
export type LeaseRenewalAutomationOverride = {
  /** null / omitted = inherit organization policy. */
  enabled?: boolean | null;
  leadDays?: number | null;
  termMonths?: number | null;
  minTermMonths?: number | null;
  autoApproveShorterTerm?: boolean | null;
};

export const DEFAULT_LEASE_RENEWAL_AUTOMATION: LeaseRenewalAutomationPolicy = {
  enabled: false,
  leadDays: 90,
  termMonths: null,
  minTermMonths: 1,
  autoApproveShorterTerm: false,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeLeaseRenewalAutomation(raw: unknown): LeaseRenewalAutomationPolicy {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const termRaw = row.termMonths;
  const termMonths =
    termRaw === null || termRaw === '' || termRaw === undefined
      ? null
      : clampInt(termRaw, 1, 120, 12);
  return {
    enabled: row.enabled === true,
    leadDays: clampInt(row.leadDays, 0, 365, DEFAULT_LEASE_RENEWAL_AUTOMATION.leadDays),
    termMonths,
    minTermMonths: clampInt(
      row.minTermMonths,
      1,
      120,
      DEFAULT_LEASE_RENEWAL_AUTOMATION.minTermMonths,
    ),
    autoApproveShorterTerm: row.autoApproveShorterTerm === true,
  };
}

export function sanitizeLeaseRenewalOverride(raw: unknown): LeaseRenewalAutomationOverride {
  if (!raw || typeof raw !== 'object') return {};
  const row = raw as Record<string, unknown>;
  const out: LeaseRenewalAutomationOverride = {};
  if (typeof row.enabled === 'boolean') out.enabled = row.enabled;
  else if (row.enabled === null) out.enabled = null;
  if (row.leadDays === null) out.leadDays = null;
  else if (row.leadDays !== undefined) out.leadDays = clampInt(row.leadDays, 0, 365, 90);
  if (row.termMonths === null) out.termMonths = null;
  else if (row.termMonths !== undefined) out.termMonths = clampInt(row.termMonths, 1, 120, 12);
  if (row.minTermMonths === null) out.minTermMonths = null;
  else if (row.minTermMonths !== undefined)
    out.minTermMonths = clampInt(row.minTermMonths, 1, 120, 1);
  if (typeof row.autoApproveShorterTerm === 'boolean') {
    out.autoApproveShorterTerm = row.autoApproveShorterTerm;
  } else if (row.autoApproveShorterTerm === null) {
    out.autoApproveShorterTerm = null;
  }
  return out;
}

/** Merge organization policy with an optional per-contract override. */
export function resolveRenewalAutomation(
  org: LeaseRenewalAutomationPolicy,
  override?: LeaseRenewalAutomationOverride | null,
): LeaseRenewalAutomationPolicy {
  if (!override) return org;
  return {
    enabled: typeof override.enabled === 'boolean' ? override.enabled : org.enabled,
    leadDays: typeof override.leadDays === 'number' ? override.leadDays : org.leadDays,
    termMonths:
      override.termMonths === null
        ? null
        : typeof override.termMonths === 'number'
          ? override.termMonths
          : org.termMonths,
    minTermMonths:
      typeof override.minTermMonths === 'number' ? override.minTermMonths : org.minTermMonths,
    autoApproveShorterTerm:
      typeof override.autoApproveShorterTerm === 'boolean'
        ? override.autoApproveShorterTerm
        : org.autoApproveShorterTerm,
  };
}

export function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** True when today is inside the auto-offer window (including overdue leases still active). */
export function isWithinRenewalLeadWindow(
  endsOn: string,
  today: string,
  leadDays: number,
): boolean {
  if (endsOn < today) return true;
  return daysBetween(today, endsOn) <= leadDays;
}
