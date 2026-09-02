import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import type { CurrencyCode, UpsertStayInventoryDayInput } from '@bhd-r/contracts';
import { createDatabase, stayInventoryDays, type Database } from '@bhd-r/db';
import { toMinorUnits } from '@/lib/format';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRStayDayOverrideDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStayDayOverrideDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStayDayOverrideDb = { db };
  }
  return globalForDb.__bhdRStayDayOverrideDb;
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

export async function upsertStayInventoryDayOnNeon(
  claims: SessionClaims,
  unitId: string,
  input: UpsertStayInventoryDayInput,
) {
  if (!claims.organizationId) throw new Error('organization_required');
  const organizationId = claims.organizationId;

  return withinTenant(claims, async (transaction) => {
    const profile = await transaction.execute(sql`
      SELECT
        sp.currency,
        sp.minor_unit,
        (
          SELECT srp.base_nightly_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS base_nightly_minor
      FROM stay_profiles sp
      WHERE sp.organization_id = ${organizationId}::uuid
        AND sp.unit_id = ${unitId}::uuid
      LIMIT 1
    `);
    const profileRows = Array.isArray(profile)
      ? profile
      : ((profile as { rows?: unknown[] }).rows ?? []);
    const profileRow = profileRows[0] as
      | {
          currency: string;
          minor_unit: number;
          base_nightly_minor: string | null;
        }
      | undefined;
    if (!profileRow) throw new Error('unit_not_found');

    const [existing] = await transaction
      .select()
      .from(stayInventoryDays)
      .where(
        and(
          eq(stayInventoryDays.organizationId, organizationId),
          eq(stayInventoryDays.unitId, unitId),
          eq(stayInventoryDays.stayDate, input.stayDate),
        ),
      )
      .limit(1);

    let effectiveRateMinor = existing?.effectiveRateMinor ?? null;
    let manualRate = existing?.manualRate ?? false;
    if (input.clearManualRate) {
      effectiveRateMinor =
        profileRow.base_nightly_minor != null ? BigInt(profileRow.base_nightly_minor) : null;
      manualRate = false;
    } else if (input.rateMajor != null && input.rateMajor.trim() !== '') {
      try {
        effectiveRateMinor = BigInt(
          toMinorUnits(input.rateMajor.trim(), profileRow.currency as CurrencyCode),
        );
        manualRate = true;
      } catch {
        throw new Error('invalid_rate');
      }
    }

    const publicNote =
      input.publicNote === undefined
        ? (existing?.publicNote ?? null)
        : input.publicNote == null || input.publicNote.trim() === ''
          ? null
          : input.publicNote.trim().slice(0, 280);

    const availabilityStatus =
      input.availabilityStatus ?? existing?.availabilityStatus ?? 'available';

    if (existing) {
      await transaction
        .update(stayInventoryDays)
        .set({
          availabilityStatus,
          effectiveRateMinor,
          manualRate,
          publicNote,
          currency: existing.currency ?? profileRow.currency,
          updatedAt: new Date(),
        })
        .where(eq(stayInventoryDays.id, existing.id));
    } else {
      await transaction.insert(stayInventoryDays).values({
        organizationId,
        unitId,
        stayDate: input.stayDate,
        availabilityStatus,
        effectiveRateMinor,
        manualRate,
        publicNote,
        currency: profileRow.currency,
      });
    }

    return {
      stayDate: input.stayDate,
      availabilityStatus,
      effectiveRateMinor: effectiveRateMinor?.toString() ?? null,
      currency: profileRow.currency,
      publicNote,
      manualRate,
    };
  });
}
