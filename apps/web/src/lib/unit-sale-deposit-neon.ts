import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { stayPolicies } from '@bhd-r/db';
import type { Tx } from '@/lib/public-booking-neon';

/**
 * The purchase booking deposit lives beside the owner's booking terms in `stay_policies`
 * (one versioned row per unit) so it ships without a schema migration.
 * `units.deposit_minor` stays the rent deposit and the fallback for older units.
 */
const POLICY_KIND = 'other';
const CODE_PREFIX = 'unit_deposit:sale:';

function saleDepositCode(unitId: string) {
  return `${CODE_PREFIX}${unitId}`;
}

export type UnitSaleDeposit = { amountMinor: string; currency: string };

/** Caller must already be scoped to `organizationId` (or elevated for public reads). */
export async function readUnitSaleDeposits(
  transaction: Tx,
  organizationId: string,
  unitIds: readonly string[],
): Promise<Map<string, UnitSaleDeposit>> {
  const result = new Map<string, UnitSaleDeposit>();
  if (!unitIds.length) return result;
  const rows = await transaction
    .select({ code: stayPolicies.code, rulesJson: stayPolicies.rulesJson })
    .from(stayPolicies)
    .where(
      and(
        eq(stayPolicies.organizationId, organizationId),
        eq(stayPolicies.kind, POLICY_KIND),
        eq(stayPolicies.status, 'active'),
        inArray(stayPolicies.code, unitIds.map(saleDepositCode)),
      ),
    );
  for (const row of rows) {
    const rules = (row.rulesJson ?? {}) as { amountMinor?: unknown; currency?: unknown };
    const amountMinor = typeof rules.amountMinor === 'string' ? rules.amountMinor : null;
    if (!amountMinor || !/^\d+$/.test(amountMinor) || amountMinor === '0') continue;
    result.set(row.code.slice(CODE_PREFIX.length), {
      amountMinor,
      currency: typeof rules.currency === 'string' ? rules.currency : '',
    });
  }
  return result;
}

/** `amountMinor` null clears the purchase deposit (the unit falls back to `deposit_minor`). */
export async function writeUnitSaleDeposit(
  transaction: Tx,
  input: {
    organizationId: string;
    unitId: string;
    amountMinor: string | null;
    currency: string;
    userId: string;
  },
) {
  const code = saleDepositCode(input.unitId);
  const scope = and(
    eq(stayPolicies.organizationId, input.organizationId),
    eq(stayPolicies.kind, POLICY_KIND),
    eq(stayPolicies.code, code),
  );
  const [current] = await transaction
    .select({ rulesJson: stayPolicies.rulesJson })
    .from(stayPolicies)
    .where(and(scope, eq(stayPolicies.status, 'active')))
    .limit(1);
  const currentRules = (current?.rulesJson ?? {}) as { amountMinor?: unknown; currency?: unknown };
  const next = input.amountMinor && input.amountMinor !== '0' ? input.amountMinor : null;
  if (
    (current ? currentRules.amountMinor : null) === next &&
    (!next || currentRules.currency === input.currency)
  ) {
    return;
  }

  await transaction
    .update(stayPolicies)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(scope, eq(stayPolicies.status, 'active')));
  if (!next) return;

  const [latest] = await transaction
    .select({ version: sql<number>`coalesce(max(${stayPolicies.version}), 0)::int` })
    .from(stayPolicies)
    .where(scope);
  await transaction.insert(stayPolicies).values({
    organizationId: input.organizationId,
    kind: POLICY_KIND,
    code,
    nameAr: 'عربون حجز الشراء',
    nameEn: 'Purchase booking deposit',
    version: (latest?.version ?? 0) + 1,
    rulesJson: {
      scope: 'unit_sale_deposit',
      unitId: input.unitId,
      amountMinor: next,
      currency: input.currency,
      updatedByUserId: input.userId,
    },
    status: 'active',
  });
}
