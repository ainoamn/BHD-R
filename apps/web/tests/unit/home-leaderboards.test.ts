import { describe, expect, it } from 'vitest';
import {
  bayesRating,
  eligible,
  maskedPersonName,
  ownerScore,
  partnerScore,
  propertyScore,
  rankEntries,
  tenantScore,
  type LeaderboardEntry,
} from '@/lib/leaderboards-shared';
import { parsePlan, subscriptionBlocksGrowth } from '@/lib/site-admin-shared';

const entry = (key: string, score: number, ratings = 0): LeaderboardEntry => ({
  key,
  name: key,
  nameEn: null,
  detailAr: '',
  detailEn: '',
  score,
  stars: null,
  ratings,
  verified: false,
  href: null,
  badges: [],
});

describe('smart leaderboard scoring', () => {
  it('does not let one five-star review beat a long strong record', () => {
    expect(bayesRating(5, 1)).toBeLessThan(bayesRating(4.7, 40));
    expect(propertyScore({ rating_avg: 5, rating_count: 1 })).toBeLessThan(
      propertyScore({ rating_avg: 4.7, rating_count: 40 }),
    );
  });

  it('falls back to the prior without ratings', () => {
    expect(bayesRating(null, 0)).toBe(3.8);
  });

  it('rewards upkeep and occupancy for buildings and owners', () => {
    const base = { rating_avg: 4.5, rating_count: 6 };
    expect(
      propertyScore({ ...base, occupancy_pct: 95, resolution_days: 1, open_maintenance: 0 }),
    ).toBeGreaterThan(
      propertyScore({ ...base, occupancy_pct: 30, resolution_days: 20, open_maintenance: 6 }),
    );
    expect(ownerScore({ ...base, properties_count: 8, verified: 1 })).toBeGreaterThan(
      ownerScore({ ...base, properties_count: 1, verified: 0 }),
    );
  });

  it('penalises tenants for arrears and legal cases', () => {
    const good = { invoices_count: 12, on_time_pct: 100, verified: 1, tenure_months: 18 };
    expect(tenantScore(good)).toBeGreaterThan(tenantScore({ ...good, overdue_count: 2 }));
    expect(eligible('tenant', { ...good, legal_cases: 1 })).toBe(false);
    expect(eligible('tenant', {})).toBe(false);
  });

  it('ranks partners on verified, punctual work', () => {
    expect(
      partnerScore({
        jobs_completed: 20,
        on_time_pct: 95,
        verified_jobs_pct: 90,
        vendor_rating: 4.8,
      }),
    ).toBeGreaterThan(partnerScore({ jobs_completed: 2, on_time_pct: 40, verified_jobs_pct: 0 }));
  });

  it('keeps scores between 0 and 100', () => {
    for (const score of [
      propertyScore({}),
      ownerScore({ properties_count: 1 }),
      tenantScore({ overdue_count: 50, legal_cases: 9 }),
      partnerScore({}),
    ]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('orders by score, then by record size', () => {
    const ranked = rankEntries([entry('a', 70, 1), entry('b', 90), entry('c', 70, 9)], 2);
    expect(ranked.map((item) => item.key)).toEqual(['b', 'c']);
  });

  it('shows people as given name and family initial', () => {
    expect(maskedPersonName('Ahmed Salim Al Harthy')).toBe('Ahmed H.');
    expect(maskedPersonName('Mona')).toBe('Mona');
    expect(maskedPersonName('  ')).toBeNull();
  });
});

describe('site admin plans', () => {
  it('accepts a well-formed plan and normalises the price', () => {
    expect(
      parsePlan({
        key: 'Pro',
        nameAr: 'المحترفين',
        nameEn: 'Pro',
        price: '9.5',
        period: 'year',
        properties: 20,
        units: 100,
        representatives: 5,
        storageGb: 20,
      }),
    ).toMatchObject({ key: 'pro', price: '9.500', period: 'year', active: true });
  });

  it('rejects bad keys, prices and limits', () => {
    const plan = {
      key: 'pro',
      nameAr: 'أ',
      nameEn: 'P',
      price: '1',
      properties: 1,
      units: 1,
      representatives: 1,
      storageGb: 1,
    };
    expect(parsePlan({ ...plan, key: '9x' })).toBeNull();
    expect(parsePlan({ ...plan, price: '-1' })).toBeNull();
    expect(parsePlan({ ...plan, units: 1.5 })).toBeNull();
  });

  it('blocks growth only for suspended or cancelled subscriptions', () => {
    expect(subscriptionBlocksGrowth('suspended')).toBe(true);
    expect(subscriptionBlocksGrowth('cancelled')).toBe(true);
    expect(subscriptionBlocksGrowth('past_due')).toBe(false);
    expect(subscriptionBlocksGrowth(undefined)).toBe(false);
  });
});
