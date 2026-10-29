import 'server-only';
import { sql } from 'drizzle-orm';
import {
  awardSerial,
  badgePrestige,
  badgeSubjectKey,
  type BadgeChip,
  type BadgeSubject,
} from '@/lib/badges-shared';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { elevatedTx, isMissingTable, rowsOf } from '@/lib/elevated-db';
import { withTimeoutFallback } from '@/lib/with-timeout';

export type { BadgeChip };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUBJECTS = 1000;

export type BadgeRef = { type: BadgeSubject; id: string | null | undefined };
export type BadgeChipMap = Map<string, BadgeChip[]>;

type ChipRow = {
  subject_type: BadgeSubject;
  subject_id: string;
  serial_year: number;
  serial_no: number;
  name_ar: string;
  name_en: string;
  tier: BadgeChip['tier'];
  level: BadgeChip['level'];
  icon: BadgeChip['icon'];
};

/**
 * Current awards for many subjects in one read, keyed by `badgeSubjectKey`. Inside a workspace
 * pass its organization so only that organization's awards appear; public pages omit it.
 */
export async function activeBadgeChips(
  refs: readonly BadgeRef[],
  organizationId?: string | null,
): Promise<BadgeChipMap> {
  const wanted = new Set(
    refs
      .filter((ref): ref is { type: BadgeSubject; id: string } => !!ref.id && UUID.test(ref.id))
      .map((ref) => badgeSubjectKey(ref.type, ref.id)),
  );
  const ids = [...new Set([...wanted].map((key) => key.slice(key.indexOf(':') + 1)))].slice(
    0,
    MAX_SUBJECTS,
  );
  const result: BadgeChipMap = new Map();
  if (!ids.length || (organizationId && !UUID.test(organizationId))) return result;
  if (!hasDatabaseUrl()) return result;
  try {
    const rows = await elevatedTx(async (tx) =>
      rowsOf<ChipRow>(
        await tx.execute(sql`
          select a.subject_type, a.subject_id::text, a.serial_year, a.serial_no,
            d.name_ar, d.name_en, d.tier, d.level, d.icon
          from badge_awards a join badge_definitions d on d.id = a.badge_id
          where a.status = 'active' and (a.expires_at is null or a.expires_at > now())
            and a.subject_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
            ${organizationId ? sql`and a.organization_id = ${organizationId}` : sql``}
          order by a.awarded_at desc nulls last
        `),
      ),
    );
    for (const row of rows) {
      const key = badgeSubjectKey(row.subject_type, row.subject_id);
      if (!wanted.has(key)) continue;
      const list = result.get(key) ?? [];
      list.push({
        serial: awardSerial(Number(row.serial_year), Number(row.serial_no)),
        nameAr: row.name_ar,
        nameEn: row.name_en,
        tier: row.tier,
        level: row.level,
        icon: row.icon,
      });
      result.set(key, list);
    }
    for (const list of result.values()) list.sort((a, b) => badgePrestige(b) - badgePrestige(a));
  } catch (error) {
    if (!isMissingTable(error)) console.error('badge chips', error);
  }
  return result;
}

/** One subject's current awards; never holds a page up for long. */
export function subjectBadgeChips(
  type: BadgeSubject,
  id: string | null | undefined,
  organizationId?: string | null,
): Promise<BadgeChip[]> {
  if (!id) return Promise.resolve([]);
  return withTimeoutFallback(
    activeBadgeChips([{ type, id }], organizationId).then((map) => chipsOf(map, type, id)),
    2_500,
    [],
    'subject-badges',
  );
}

/** The building and guest of a daily-stay booking. */
export async function stayBookingBadges(booking: {
  propertyId: string;
  guestPartyId?: string | null;
}): Promise<{ property: BadgeChip[]; guest: BadgeChip[] }> {
  const chips = await withTimeoutFallback(
    activeBadgeChips([
      { type: 'property', id: booking.propertyId },
      { type: 'tenant', id: booking.guestPartyId },
    ]),
    2_500,
    new Map<string, BadgeChip[]>(),
    'stay-booking-badges',
  );
  return {
    property: chipsOf(chips, 'property', booking.propertyId),
    guest: chipsOf(chips, 'tenant', booking.guestPartyId),
  };
}

/** Public rows that carry a building id, returned with that building's current awards. */
export async function withPropertyBadges<T extends { propertyId?: string | null }>(
  rows: T[],
): Promise<(T & { badges?: BadgeChip[] })[]> {
  if (!rows.length) return rows;
  const chips = await activeBadgeChips(
    rows.map((row) => ({ type: 'property', id: row.propertyId })),
  );
  if (!chips.size) return rows;
  return rows.map((row) => {
    const badges = chipsOf(chips, 'property', row.propertyId);
    return badges.length ? { ...row, badges } : row;
  });
}

/** A party's awards as an owner and as a tenant, most prestigious first. */
export function partyChipsOf(map: BadgeChipMap, partyId: string | null | undefined): BadgeChip[] {
  return [...chipsOf(map, 'owner', partyId), ...chipsOf(map, 'tenant', partyId)].sort(
    (a, b) => badgePrestige(b) - badgePrestige(a),
  );
}

/** Owner and tenant awards for many parties of one organization. */
export function partyBadgeChips(
  organizationId: string,
  partyIds: readonly (string | null | undefined)[],
): Promise<BadgeChipMap> {
  return withTimeoutFallback(
    activeBadgeChips(
      partyIds.flatMap((id): BadgeRef[] => [
        { type: 'owner', id },
        { type: 'tenant', id },
      ]),
      organizationId,
    ),
    2_500,
    new Map<string, BadgeChip[]>(),
    'party-badges',
  );
}

export function chipsOf(map: BadgeChipMap, type: BadgeSubject, id: string | null | undefined) {
  return id ? (map.get(badgeSubjectKey(type, id)) ?? []) : [];
}
