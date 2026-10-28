import 'server-only';
import {
  formatChildContractReference,
  isChildContractReference,
  nextChildContractSequence,
} from '@bhd-r/domain';
import { contracts, type Database } from '@bhd-r/db';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Next addendum / renewal / termination reference under a parent contract.
 * Does not consume the org-year CTR sequence.
 */
export async function allocateChildContractReference(
  tx: Tx,
  orgId: string,
  parentId: string,
  parentReference: string,
): Promise<string> {
  const parentRef =
    parentReference.trim() || `CTR-${parentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${parentId}, 41))`);
  const siblings = await tx
    .select({ reference: contracts.reference })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        eq(contracts.parentContractId, parentId),
        ne(contracts.status, 'void'),
      ),
    );
  const sequence = nextChildContractSequence(
    parentRef,
    siblings.map((row) => row.reference).filter((value): value is string => Boolean(value)),
  );
  return formatChildContractReference(parentRef, sequence);
}

/**
 * Renumber every non-void child so references are parent-02, parent-03, … by createdAt.
 * Updates payloadSnapshot.contract.reference when present.
 */
export async function repairChildContractReferencesInTx(tx: Tx, orgId: string): Promise<number> {
  const parents = await tx
    .select({
      id: contracts.id,
      reference: contracts.reference,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        sql`${contracts.parentContractId} is null`,
        ne(contracts.status, 'void'),
      ),
    );

  let changed = 0;
  for (const parent of parents) {
    const parentRef =
      parent.reference?.trim() || `CTR-${parent.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const children = await tx
      .select({
        id: contracts.id,
        reference: contracts.reference,
        payloadSnapshot: contracts.payloadSnapshot,
        createdAt: contracts.createdAt,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.organizationId, orgId),
          eq(contracts.parentContractId, parent.id),
          ne(contracts.status, 'void'),
        ),
      )
      .orderBy(asc(contracts.createdAt));

    if (!children.length) continue;
    const needsRepair = children.some(
      (child) => !child.reference || !isChildContractReference(child.reference, parentRef),
    );
    if (!needsRepair) continue;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${parent.id}, 41))`);

    for (const child of children) {
      const temp = `TMP-${child.id.replace(/-/g, '').slice(0, 20)}`;
      await tx
        .update(contracts)
        .set({ reference: temp })
        .where(and(eq(contracts.id, child.id), eq(contracts.organizationId, orgId)));
    }

    let sequence = 2;
    for (const child of children) {
      const nextRef = formatChildContractReference(parentRef, sequence);
      sequence += 1;
      const payload =
        child.payloadSnapshot && typeof child.payloadSnapshot === 'object'
          ? { ...(child.payloadSnapshot as Record<string, unknown>) }
          : {};
      const contractMeta =
        payload.contract && typeof payload.contract === 'object'
          ? { ...(payload.contract as Record<string, unknown>) }
          : {};
      contractMeta.reference = nextRef;
      contractMeta.parentReference = parentRef;
      payload.contract = contractMeta;
      await tx
        .update(contracts)
        .set({ reference: nextRef, payloadSnapshot: payload })
        .where(and(eq(contracts.id, child.id), eq(contracts.organizationId, orgId)));
      if (child.reference !== nextRef) changed += 1;
    }
  }
  return changed;
}
