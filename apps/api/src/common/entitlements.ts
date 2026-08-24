import { ConflictException } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  assertWithinEntitlement,
  type EntitlementMetric,
  entitlementsForPlan,
} from '@bhd-r/domain';
import { organizations, properties, representationAuthorities, units } from '@bhd-r/db';
import type { DatabaseTransaction } from '../database/database.service.js';

export async function loadOrganizationPlan(
  transaction: DatabaseTransaction,
  organizationId: string,
) {
  const organization = await transaction.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!organization) throw new ConflictException('Organization was not found');
  return organization;
}

async function countMetric(
  transaction: DatabaseTransaction,
  organizationId: string,
  metric: EntitlementMetric,
): Promise<number> {
  if (metric === 'properties') {
    const rows = await transaction
      .select({ value: count() })
      .from(properties)
      .where(
        and(eq(properties.organizationId, organizationId), sql`${properties.status} <> 'archived'`),
      );
    return Number(rows[0]?.value ?? 0);
  }
  if (metric === 'units') {
    const rows = await transaction
      .select({ value: count() })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), sql`${units.status} <> 'archived'`));
    return Number(rows[0]?.value ?? 0);
  }
  if (metric === 'representatives') {
    const rows = await transaction
      .select({ value: count() })
      .from(representationAuthorities)
      .where(
        and(
          eq(representationAuthorities.organizationId, organizationId),
          eq(representationAuthorities.status, 'active'),
          sql`(${representationAuthorities.endsOn} IS NULL OR ${representationAuthorities.endsOn} >= CURRENT_DATE)`,
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }
  return 0;
}

export async function assertOrganizationEntitlement(
  transaction: DatabaseTransaction,
  organizationId: string,
  metric: EntitlementMetric,
  requested = 1,
): Promise<void> {
  const organization = await loadOrganizationPlan(transaction, organizationId);
  const current = await countMetric(transaction, organizationId, metric);
  const decision = assertWithinEntitlement({
    planKey: organization.planKey,
    metric,
    current,
    requested,
  });
  if (!decision.ok) {
    const plan = entitlementsForPlan(organization.planKey);
    throw new ConflictException(
      `Plan ${plan.key} allows at most ${decision.limit} ${metric}; requested total would be ${decision.next}`,
    );
  }
}
