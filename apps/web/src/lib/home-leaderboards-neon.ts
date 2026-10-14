import 'server-only';
import { sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { activeBadgeChips, chipsOf, type BadgeChipMap } from '@/lib/badge-chips-neon';
import { computeMetrics, type SubjectMetrics } from '@/lib/badges-engine-neon';
import type { BadgeSubject } from '@/lib/badges-shared';
import { elevatedTx, isMissingTable, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import {
  EMPTY_LEADERBOARDS,
  eligible,
  maskedPersonName,
  ownerScore,
  partnerScore,
  propertyScore,
  rankEntries,
  tenantScore,
  type HomeLeaderboards,
  type HomeStats,
  type LeaderboardEntry,
  type LeaderboardKind,
} from '@/lib/leaderboards-shared';
import { withTimeoutFallback } from '@/lib/with-timeout';

const WINDOW_DAYS = 365;
const MAX_ORGANIZATIONS = 80;
const PER_BOARD = 5;
const COMPUTE_BUDGET_MS = 14_000;

type Organization = { id: string; type: string; name_ar: string; name_en: string | null };
type PublicProperty = {
  id: string;
  name_en: string | null;
  place: string | null;
  units: number;
};

type Candidate = {
  kind: LeaderboardKind;
  subject: BadgeSubject;
  id: string;
  build: (badges: LeaderboardEntry['badges']) => LeaderboardEntry;
};

const SUBJECT_OF: Record<LeaderboardKind, BadgeSubject> = {
  property: 'property',
  owner: 'owner',
  tenant: 'tenant',
  partner: 'worker',
};

async function publicProperties(
  tx: ElevatedTx,
  organizationId: string,
): Promise<Map<string, PublicProperty>> {
  const rows = rowsOf<PublicProperty>(
    await tx.execute(sql`
      select p.id::text, p.name_en, coalesce(nullif(a.wilayat, ''), nullif(a.governorate, ''), a.city) as place,
        count(u.id)::int as units
      from properties p
        join addresses a on a.id = p.address_id
        join units u on u.property_id = p.id and u.publish_when_available = true
          and u.status in ('active', 'draft', 'inactive')
      where p.organization_id = ${organizationId} and p.status = 'active'
      group by p.id, p.name_en, a.wilayat, a.governorate, a.city
    `),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function namedOwners(tx: ElevatedTx, organizationId: string): Promise<Set<string>> {
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`
      select distinct p.owner_party_id::text as id
      from properties p join property_profiles pp on pp.property_id = p.id
      where p.organization_id = ${organizationId} and p.status <> 'archived'
        and pp.show_owner_name_on_listing = true
    `),
  );
  return new Set(rows.map((row) => row.id));
}

async function vendorCategories(
  tx: ElevatedTx,
  organizationId: string,
): Promise<Map<string, string | null>> {
  const rows = rowsOf<{ id: string; category: string | null }>(
    await tx.execute(sql`
      select id::text, category from vendors where organization_id = ${organizationId} and active
    `),
  );
  return new Map(rows.map((row) => [row.id, row.category]));
}

function stars(value: number | null | undefined, count: number): number | null {
  return typeof value === 'number' && count > 0 ? Math.round(value * 10) / 10 : null;
}

function organizationCandidates(
  organization: Organization,
  metrics: Record<LeaderboardKind, Map<string, SubjectMetrics>>,
  listed: Map<string, PublicProperty>,
  named: Set<string>,
  categories: Map<string, string | null>,
): Candidate[] {
  const business = organization.type === 'company' || organization.type === 'developer';
  const out: Candidate[] = [];

  for (const [id, { name, metrics: m }] of metrics.property) {
    const listing = listed.get(id);
    if (!listing || !eligible('property', m)) continue;
    const count = Number(m.rating_count ?? 0);
    out.push({
      kind: 'property',
      subject: 'property',
      id,
      build: (badges) => ({
        key: `property:${id}`,
        name,
        nameEn: listing.name_en,
        detailAr: [listing.place, `${listing.units} وحدة معروضة`].filter(Boolean).join(' · '),
        detailEn: [listing.place, `${listing.units} listed unit${listing.units === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · '),
        score: propertyScore(m, badges),
        stars: stars(m.rating_avg, count),
        ratings: count,
        verified: m.owner_verified === 1,
        href: `/properties/${id}`,
        badges,
      }),
    });
  }

  for (const [id, { name, metrics: m }] of metrics.owner) {
    if (!eligible('owner', m)) continue;
    const count = Number(m.rating_count ?? 0);
    const properties = Number(m.properties_count ?? 0);
    const occupancy = typeof m.occupancy_pct === 'number' ? Math.round(m.occupancy_pct) : null;
    out.push({
      kind: 'owner',
      subject: 'owner',
      id,
      build: (badges) => ({
        key: `owner:${id}`,
        name: business ? organization.name_ar : named.has(id) ? maskedPersonName(name) : null,
        nameEn: business ? organization.name_en : null,
        detailAr: [
          business ? 'إدارة أملاك' : 'مالك',
          `${properties} عقار`,
          occupancy !== null ? `إشغال ${occupancy}%` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        detailEn: [
          business ? 'Property manager' : 'Owner',
          `${properties} propert${properties === 1 ? 'y' : 'ies'}`,
          occupancy !== null ? `${occupancy}% occupied` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        score: ownerScore(m, badges),
        stars: stars(m.rating_avg, count),
        ratings: count,
        verified: m.verified === 1,
        href: null,
        badges,
      }),
    });
  }

  for (const [id, { name, metrics: m }] of metrics.tenant) {
    if (!eligible('tenant', m)) continue;
    const count = Number(m.guest_rating_count ?? 0);
    const onTime = typeof m.on_time_pct === 'number' ? Math.round(m.on_time_pct) : null;
    const months = Number(m.tenure_months ?? 0);
    out.push({
      kind: 'tenant',
      subject: 'tenant',
      id,
      build: (badges) => ({
        key: `tenant:${id}`,
        name: maskedPersonName(name),
        nameEn: null,
        detailAr: [
          onTime !== null ? `سداد في الموعد ${onTime}%` : null,
          months ? `${months} شهر على المنصة` : 'عضو جديد',
        ]
          .filter(Boolean)
          .join(' · '),
        detailEn: [
          onTime !== null ? `${onTime}% paid on time` : null,
          months ? `${months} months on BHD R` : 'New member',
        ]
          .filter(Boolean)
          .join(' · '),
        score: tenantScore(m, badges),
        stars: stars(m.guest_rating_avg, count),
        ratings: count,
        verified: m.verified === 1,
        href: null,
        badges,
      }),
    });
  }

  for (const [id, { name, metrics: m }] of metrics.partner) {
    if (!eligible('partner', m)) continue;
    const jobs = Number(m.jobs_completed ?? 0);
    const category = categories.get(id) ?? null;
    out.push({
      kind: 'partner',
      subject: 'worker',
      id,
      build: (badges) => ({
        key: `partner:${id}`,
        name,
        nameEn: null,
        detailAr: [category, jobs ? `${jobs} مهمة منجزة` : null].filter(Boolean).join(' · '),
        detailEn: [category, jobs ? `${jobs} job${jobs === 1 ? '' : 's'} done` : null]
          .filter(Boolean)
          .join(' · '),
        score: partnerScore(m, badges),
        stars: stars(m.vendor_rating, typeof m.vendor_rating === 'number' ? Math.max(jobs, 1) : 0),
        ratings: jobs,
        verified: m.verified === 1,
        href: null,
        badges,
      }),
    });
  }
  return out;
}

async function platformStats(): Promise<HomeStats> {
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{
      units: number;
      properties: number;
      partners: number;
      ratings: number;
    }>(
      await tx.execute(sql`
        select
          (select count(*)::int from units u join properties p on p.id = u.property_id
            join organizations o on o.id = p.organization_id
            where u.publish_when_available and p.status = 'active' and o.status = 'active'
              and u.status in ('active', 'draft', 'inactive')) as units,
          (select count(distinct p.id)::int from units u join properties p on p.id = u.property_id
            join organizations o on o.id = p.organization_id
            where u.publish_when_available and p.status = 'active' and o.status = 'active') as properties,
          (select count(*)::int from vendors v join organizations o on o.id = v.organization_id
            where v.active and o.status = 'active') as partners,
          (select count(*)::int from reviews where status = 'published')
            + (select count(*)::int from booking_reviews where status = 'published')
            + (select count(*)::int from stay_reviews where status = 'published') as ratings
      `),
    );
    return {
      publicUnits: Number(row?.units ?? 0),
      properties: Number(row?.properties ?? 0),
      partners: Number(row?.partners ?? 0),
      ratings: Number(row?.ratings ?? 0),
    };
  });
}

/**
 * Platform-wide leaderboards for the home page, ranked from ratings and each organization's own
 * operating record over the last year. Only published buildings link out; people keep their
 * given name and family initial, and private owners stay anonymous unless they opted in.
 */
export async function computeHomeLeaderboards(): Promise<HomeLeaderboards> {
  const started = Date.now();
  const organizations = await elevatedTx(async (tx) =>
    rowsOf<Organization>(
      await tx.execute(sql`
        select id::text, type::text, display_name_ar as name_ar, display_name_en as name_en
        from organizations where status = 'active'
        order by updated_at desc nulls last limit ${MAX_ORGANIZATIONS}
      `),
    ),
  );
  const candidates: Candidate[] = [];
  for (const organization of organizations) {
    if (Date.now() - started > COMPUTE_BUDGET_MS) break;
    try {
      candidates.push(
        ...(await elevatedTx(async (tx) => {
          const listed = await publicProperties(tx, organization.id);
          const [property, owner, tenant, partner] = [
            listed.size
              ? await computeMetrics(tx, organization.id, 'property', WINDOW_DAYS)
              : new Map<string, SubjectMetrics>(),
            await computeMetrics(tx, organization.id, 'owner', WINDOW_DAYS),
            await computeMetrics(tx, organization.id, 'tenant', WINDOW_DAYS),
            await computeMetrics(tx, organization.id, 'worker', WINDOW_DAYS),
          ];
          const named = owner.size ? await namedOwners(tx, organization.id) : new Set<string>();
          const categories = partner.size
            ? await vendorCategories(tx, organization.id)
            : new Map<string, string | null>();
          return organizationCandidates(
            organization,
            { property, owner, tenant, partner },
            listed,
            named,
            categories,
          );
        }, 10_000)),
      );
    } catch (error) {
      if (!isMissingTable(error)) console.error('home leaderboards', organization.id, error);
    }
  }

  const chips: BadgeChipMap = candidates.length
    ? await activeBadgeChips(candidates.map((item) => ({ type: item.subject, id: item.id })))
    : new Map<string, LeaderboardEntry['badges']>();
  const boards = { ...EMPTY_LEADERBOARDS.boards };
  for (const kind of Object.keys(SUBJECT_OF) as LeaderboardKind[]) {
    boards[kind] = rankEntries(
      candidates
        .filter((item) => item.kind === kind)
        .map((item) => item.build(chipsOf(chips, item.subject, item.id))),
      PER_BOARD,
    );
  }
  const stats = await platformStats().catch(() => EMPTY_LEADERBOARDS.stats);
  return { boards, stats, updatedAt: new Date().toISOString() };
}

const cachedLeaderboards = unstable_cache(computeHomeLeaderboards, ['home-leaderboards-v1'], {
  revalidate: 1800,
  tags: ['home-leaderboards'],
});

/** Cached for half an hour, so rankings follow new ratings and activity on their own. */
export async function loadHomeLeaderboardsSafe(): Promise<HomeLeaderboards> {
  try {
    return await withTimeoutFallback(
      cachedLeaderboards(),
      9_000,
      EMPTY_LEADERBOARDS,
      'home-leaderboards',
    );
  } catch (error) {
    console.error('home leaderboards', error);
    return EMPTY_LEADERBOARDS;
  }
}
