import 'server-only';
import { sql } from 'drizzle-orm';
import { elevatedTx, isMissingTable, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { NO_MARK, type IdentityMark } from '@/lib/identity-shared';
import { bestNameMatch, NAME_MATCH_THRESHOLD } from '@/lib/verification-shared';

export { NO_MARK, type IdentityMark };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function cleanIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => !!id && UUID.test(id)))].slice(0, 1000);
}

export function avatarUrl(kind: 'user' | 'organization', id: string, version: number | string) {
  return `/api/public/avatar/${kind}/${id}?v=${version}`;
}

async function avatars(
  tx: ElevatedTx,
  kind: 'user' | 'organization',
  ids: string[],
): Promise<Map<string, string>> {
  const found = rowsOf<{ subject_id: string; v: string }>(
    await tx.execute(sql`
      select subject_id::text, extract(epoch from updated_at)::bigint::text as v
      from profile_images
      where subject_type = ${kind} and subject_id in (${uuidList(ids)})
    `),
  );
  return new Map(found.map((row) => [row.subject_id, avatarUrl(kind, row.subject_id, row.v)]));
}

/** Users whose personal verification is current and whose account name still matches it. */
export async function verifiedUsers(tx: ElevatedTx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map<string, string>();
  const found = rowsOf<{
    user_id: string;
    display_name: string;
    legal_name_ar: string | null;
    legal_name_en: string | null;
    verified_until: Date | string;
  }>(
    await tx.execute(sql`
      select v.user_id::text, u.display_name, v.legal_name_ar, v.legal_name_en, v.verified_until
      from account_verifications v join users u on u.id = v.user_id
      where v.kind = 'personal' and v.status = 'approved'
        and v.verified_from <= now() and v.verified_until > now()
        and v.user_id in (${uuidList(ids)})
      order by v.verified_until desc
    `),
  );
  const verified = new Map<string, string>();
  for (const row of found) {
    if (verified.has(row.user_id)) continue;
    if (
      bestNameMatch([row.legal_name_ar, row.legal_name_en], [row.display_name]) >=
      NAME_MATCH_THRESHOLD
    ) {
      verified.set(row.user_id, new Date(row.verified_until).toISOString());
    }
  }
  return verified;
}

/** Organizations with a current business verification whose name still matches the registration. */
export async function verifiedOrganizations(
  tx: ElevatedTx,
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map<string, string>();
  const found = rowsOf<{
    organization_id: string;
    display_name_ar: string;
    display_name_en: string;
    legal_name: string;
    legal_name_ar: string | null;
    legal_name_en: string | null;
    verified_until: Date | string;
  }>(
    await tx.execute(sql`
      select v.organization_id::text, o.display_name_ar, o.display_name_en, o.legal_name,
        v.legal_name_ar, v.legal_name_en, v.verified_until
      from account_verifications v join organizations o on o.id = v.organization_id
      where v.kind = 'business' and v.status = 'approved'
        and v.verified_from <= now() and v.verified_until > now()
        and v.organization_id in (${uuidList(ids)})
      order by v.verified_until desc
    `),
  );
  const verified = new Map<string, string>();
  for (const row of found) {
    if (verified.has(row.organization_id)) continue;
    const score = bestNameMatch(
      [row.legal_name_ar, row.legal_name_en],
      [row.display_name_ar, row.display_name_en, row.legal_name],
    );
    if (score >= NAME_MATCH_THRESHOLD) {
      verified.set(row.organization_id, new Date(row.verified_until).toISOString());
    }
  }
  return verified;
}

/**
 * The account behind each party: a team membership, a matching e-mail, or a guest booking. The
 * party's name must also match the account's, so typing someone's e-mail on a contact cannot
 * lend that contact their verified tick.
 */
export async function partyAccounts(
  tx: ElevatedTx,
  organizationId: string,
  partyIds: string[],
): Promise<Map<string, string>> {
  if (!partyIds.length) return new Map<string, string>();
  const found = rowsOf<{
    party_id: string;
    party_name: string;
    user_id: string | null;
    user_name: string | null;
  }>(
    await tx.execute(sql`
      select p.id::text as party_id, p.display_name as party_name,
        u.id::text as user_id, u.display_name as user_name
      from parties p
      left join lateral (select coalesce(
        (select m.user_id from memberships m
          where m.organization_id = p.organization_id and m.party_id = p.id and m.status = 'active'
          order by m.created_at limit 1),
        (select x.id from users x
          where p.email is not null and lower(x.email) = lower(p.email) limit 1),
        (select b.user_id from stay_bookings b
          where b.organization_id = p.organization_id and b.guest_party_id = p.id
            and b.user_id is not null
          order by b.created_at desc limit 1)
      ) as uid) linked on true
      left join users u on u.id = linked.uid
      where p.organization_id = ${organizationId} and p.id in (${uuidList(partyIds)})
    `),
  );
  return new Map(
    found
      .filter(
        (row) =>
          row.user_id &&
          row.user_name &&
          Math.max(
            bestNameMatch([row.party_name], [row.user_name]),
            bestNameMatch([row.user_name], [row.party_name]),
          ) >= NAME_MATCH_THRESHOLD,
      )
      .map((row) => [row.party_id, row.user_id as string]),
  );
}

export async function userMarks(tx: ElevatedTx, ids: string[]): Promise<Map<string, IdentityMark>> {
  if (!ids.length) return new Map<string, IdentityMark>();
  const [verified, pictures] = [await verifiedUsers(tx, ids), await avatars(tx, 'user', ids)];
  return new Map(
    ids.map((id) => [id, { verified: verified.has(id), avatarUrl: pictures.get(id) ?? null }]),
  );
}

async function safely<T>(work: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isMissingTable(error)) console.error('identity marks', error);
    return empty;
  }
}

export function marksForUsers(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, IdentityMark>> {
  const clean = cleanIds(ids);
  if (!clean.length) return Promise.resolve(new Map<string, IdentityMark>());
  return safely(() => elevatedTx((tx) => userMarks(tx, clean)), new Map<string, IdentityMark>());
}

export function marksForOrganizations(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, IdentityMark>> {
  const clean = cleanIds(ids);
  if (!clean.length) return Promise.resolve(new Map<string, IdentityMark>());
  return safely(
    () =>
      elevatedTx(async (tx) => {
        const [verified, pictures] = [
          await verifiedOrganizations(tx, clean),
          await avatars(tx, 'organization', clean),
        ];
        return new Map(
          clean.map((id) => [
            id,
            { verified: verified.has(id), avatarUrl: pictures.get(id) ?? null },
          ]),
        );
      }),
    new Map<string, IdentityMark>(),
  );
}

/** Marks for an organization's parties, through the account each one belongs to. */
export function marksForParties(
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, IdentityMark>> {
  const clean = cleanIds(ids);
  if (!clean.length || !UUID.test(organizationId))
    return Promise.resolve(new Map<string, IdentityMark>());
  return safely(
    () =>
      elevatedTx(async (tx) => {
        const accounts = await partyAccounts(tx, organizationId, clean);
        const marks = await userMarks(tx, [...new Set(accounts.values())]);
        const result = new Map<string, IdentityMark>();
        for (const [partyId, userId] of accounts) result.set(partyId, marks.get(userId) ?? NO_MARK);
        return result;
      }),
    new Map<string, IdentityMark>(),
  );
}
