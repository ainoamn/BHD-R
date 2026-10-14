import type { BadgeChip, MetricValues } from '@/lib/badges-shared';

export const LEADERBOARD_KINDS = ['property', 'partner', 'owner', 'tenant'] as const;
export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

export type LeaderboardEntry = {
  key: string;
  name: string | null;
  nameEn: string | null;
  /** A short public context line: city, portfolio size, jobs done… */
  detailAr: string;
  detailEn: string;
  /** 0–100 composite score from ratings and internal operations. */
  score: number;
  /** Stars out of 5 when someone actually rated them. */
  stars: number | null;
  ratings: number;
  verified: boolean;
  href: string | null;
  badges: BadgeChip[];
};

export type HomeStats = {
  publicUnits: number;
  properties: number;
  partners: number;
  ratings: number;
};

export type HomeLeaderboards = {
  boards: Record<LeaderboardKind, LeaderboardEntry[]>;
  stats: HomeStats;
  updatedAt: string | null;
};

export const EMPTY_LEADERBOARDS: HomeLeaderboards = {
  boards: { property: [], partner: [], owner: [], tenant: [] },
  stats: { publicUnits: 0, properties: 0, partners: 0, ratings: 0 },
  updatedAt: null,
};

const RATING_PRIOR = 3.8;
const RATING_WEIGHT = 3;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const pct = (value: number | null | undefined, fallback: number) =>
  value === null || value === undefined ? fallback : clamp(value / 100);
const n = (value: number | null | undefined) => (typeof value === 'number' ? value : 0);

/**
 * Bayesian mean: a single five-star review cannot outrank a long record of 4.7. Without any
 * rating it returns the platform prior.
 */
export function bayesRating(
  avg: number | null | undefined,
  count: number,
  prior = RATING_PRIOR,
  weight = RATING_WEIGHT,
): number {
  if (avg === null || avg === undefined || count <= 0) return prior;
  return (prior * weight + avg * count) / (weight + count);
}

/** 1–5 stars mapped to 0–1. */
const starsPart = (stars: number) => clamp((stars - 1) / 4);
const tenurePart = (months: number | null | undefined) => clamp(n(months) / 24);

/** Prestige of the best current badge, 0–1. */
export function badgeBoost(badges: readonly Pick<BadgeChip, 'tier' | 'level'>[]): number {
  const tier = { medal: 4, certificate: 3, shield: 2, badge: 1 } as const;
  const level = { diamond: 5, platinum: 4, gold: 3, silver: 2, bronze: 1 } as const;
  const best = badges.reduce(
    (top, chip) => Math.max(top, tier[chip.tier] * 10 + level[chip.level]),
    0,
  );
  return clamp(best / 45);
}

function maintenancePart(metrics: MetricValues): number {
  const days = metrics.resolution_days;
  const speed = days === null || days === undefined ? 0.6 : clamp(1 - days / 14);
  const backlog = 1 - clamp(n(metrics.open_maintenance) / 5) * 0.6;
  return 0.5 * speed + 0.5 * backlog;
}

const finish = (raw: number, badges: readonly Pick<BadgeChip, 'tier' | 'level'>[]) =>
  Math.round(clamp(raw + badgeBoost(badges) * 0.05) * 100);

/** Buildings: guest ratings first, then occupancy, upkeep, a verified owner and track record. */
export function propertyScore(metrics: MetricValues, badges: readonly BadgeChip[] = []): number {
  const count = n(metrics.rating_count);
  return finish(
    0.45 * starsPart(bayesRating(metrics.rating_avg, count)) +
      0.15 * pct(metrics.occupancy_pct, 0.5) +
      0.15 * maintenancePart(metrics) +
      0.07 * n(metrics.owner_verified) +
      0.06 * tenurePart(metrics.active_months) +
      0.12 * clamp(count / 5),
    badges,
  );
}

/** Owners and property managers: their buildings' ratings and running, portfolio and trust. */
export function ownerScore(metrics: MetricValues, badges: readonly BadgeChip[] = []): number {
  const count = n(metrics.rating_count);
  const portfolio = clamp(Math.log2(1 + n(metrics.properties_count)) / Math.log2(11));
  return finish(
    0.38 * starsPart(bayesRating(metrics.rating_avg, count)) +
      0.14 * pct(metrics.occupancy_pct, 0.5) +
      0.14 * maintenancePart(metrics) +
      0.1 * portfolio +
      0.08 * n(metrics.verified) +
      0.06 * tenurePart(metrics.tenure_months) +
      0.1 * clamp(count / 8),
    badges,
  );
}

/** Tenants and guests: paying on time and hosts' ratings, minus arrears and legal cases. */
export function tenantScore(metrics: MetricValues, badges: readonly BadgeChip[] = []): number {
  const invoices = n(metrics.invoices_count);
  const onTime = invoices
    ? (pct(metrics.on_time_pct, 0) * invoices + 0.7 * 2) / (invoices + 2)
    : 0.7;
  const ratings = n(metrics.guest_rating_count);
  const activity = clamp((invoices + n(metrics.stays_count) + ratings) / 6);
  const penalty = clamp(n(metrics.overdue_count) * 0.12 + n(metrics.legal_cases) * 0.3, 0, 0.8);
  return finish(
    0.35 * onTime +
      0.25 * starsPart(bayesRating(metrics.guest_rating_avg, ratings)) +
      0.15 * activity +
      0.1 * n(metrics.verified) +
      0.1 * tenurePart(metrics.tenure_months) +
      0.05 * (n(metrics.active_leases) > 0 ? 1 : 0) -
      penalty,
    badges,
  );
}

/** Maintenance partners: owners' rating, punctuality, verified work and staying on budget. */
export function partnerScore(metrics: MetricValues, badges: readonly BadgeChip[] = []): number {
  const jobs = n(metrics.jobs_completed);
  return finish(
    0.3 *
      starsPart(bayesRating(metrics.vendor_rating, metrics.vendor_rating ? Math.max(jobs, 1) : 0)) +
      0.2 * pct(metrics.on_time_pct, 0.5) +
      0.15 * pct(metrics.verified_jobs_pct, 0.4) +
      0.1 * pct(metrics.cost_accuracy_pct, 0.5) +
      0.12 * clamp(jobs / 10) +
      0.08 * n(metrics.verified) +
      0.05 * tenurePart(metrics.tenure_months),
    badges,
  );
}

/** Enough record to be ranked publicly at all. */
export function eligible(kind: LeaderboardKind, metrics: MetricValues): boolean {
  switch (kind) {
    case 'property':
      return true;
    case 'owner':
      return n(metrics.properties_count) > 0;
    case 'tenant':
      return (
        n(metrics.legal_cases) === 0 &&
        n(metrics.overdue_count) <= 2 &&
        n(metrics.invoices_count) +
          n(metrics.stays_count) +
          n(metrics.guest_rating_count) +
          n(metrics.active_leases) >
          0
      );
    default:
      return n(metrics.jobs_completed) > 0 || n(metrics.vendor_rating) > 0;
  }
}

/** People appear as given name and family initial only. */
export function maskedPersonName(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length < 2) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

/** Highest score first; ties go to the larger record, then the name for a stable order. */
export function rankEntries(entries: LeaderboardEntry[], limit: number): LeaderboardEntry[] {
  return [...entries]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.ratings - a.ratings ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit);
}
