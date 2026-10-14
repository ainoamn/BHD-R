import 'server-only';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { elevatedTx, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { avatarUrl } from '@/lib/identity-marks-neon';
import { decodeDataUrl, squareAvatar } from '@/lib/image-compact';

export type ProfileSubject = 'user' | 'organization';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGER_ROLES = sql`('organization_owner', 'organization_admin')`;

function fail(code: string): never {
  throw new Error(code);
}

/** Whether the account may speak for this organization (logo, business verification). */
export async function managesOrganization(
  tx: ElevatedTx,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const found = rowsOf<{ ok: number }>(
    await tx.execute(sql`
      select 1 as ok from memberships
      where user_id = ${userId} and organization_id = ${organizationId}
        and status = 'active' and role_key in ${MANAGER_ROLES}
      limit 1
    `),
  );
  return found.length > 0;
}

async function assertSubject(
  tx: ElevatedTx,
  claims: SessionClaims,
  subject: ProfileSubject,
  subjectId: string,
) {
  if (!UUID.test(subjectId)) fail('not_found');
  if (subject === 'user') {
    if (subjectId !== claims.sub) fail('forbidden');
    return;
  }
  if (!(await managesOrganization(tx, claims.sub, subjectId))) fail('forbidden');
}

export async function saveProfileImage(
  claims: SessionClaims,
  subject: ProfileSubject,
  subjectId: string,
  dataUrl: string,
): Promise<{ avatarUrl: string }> {
  const image = await squareAvatar(dataUrl);
  return elevatedTx(async (tx) => {
    await assertSubject(tx, claims, subject, subjectId);
    const [row] = rowsOf<{ v: string }>(
      await tx.execute(sql`
        insert into profile_images (subject_type, subject_id, data_url, updated_by_user_id)
        values (${subject}, ${subjectId}, ${image}, ${claims.sub})
        on conflict (subject_type, subject_id) do update set
          data_url = excluded.data_url, updated_at = now(),
          updated_by_user_id = excluded.updated_by_user_id
        returning extract(epoch from updated_at)::bigint::text as v
      `),
    );
    return { avatarUrl: avatarUrl(subject, subjectId, row?.v ?? Date.now()) };
  });
}

export async function deleteProfileImage(
  claims: SessionClaims,
  subject: ProfileSubject,
  subjectId: string,
): Promise<{ ok: true }> {
  return elevatedTx(async (tx) => {
    await assertSubject(tx, claims, subject, subjectId);
    await tx.execute(sql`delete from profile_images
      where subject_type = ${subject} and subject_id = ${subjectId}`);
    return { ok: true as const };
  });
}

export async function readProfileImage(
  subject: ProfileSubject,
  subjectId: string,
): Promise<{ mime: string; bytes: Buffer; updatedAt: Date } | null> {
  if (!UUID.test(subjectId)) return null;
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ data_url: string; updated_at: Date | string }>(
      await tx.execute(sql`select data_url, updated_at from profile_images
        where subject_type = ${subject} and subject_id = ${subjectId}`),
    );
    if (!row) return null;
    const decoded = decodeDataUrl(row.data_url);
    if (!decoded || !decoded.mime.startsWith('image/')) return null;
    return { ...decoded, updatedAt: new Date(row.updated_at) };
  });
}
