/**
 * Tenant AR / deposit balances and collection evidence from posted journals only.
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  chequeOperations,
  journalEntries,
  journalLines,
  ledgerAccounts,
  payments,
} from '@bhd-r/db';
import type { ElevatedTx } from '@/lib/elevated-db';
import {
  applyGlEvidenceToStatement,
  type GlLeaseEvidence,
} from '@/lib/accounting-tenant-gl-shared';

export type { GlLeaseEvidence };
export { applyGlEvidenceToStatement };

type Tx = ElevatedTx;

function big(value: string | null | undefined): bigint {
  if (!value || !/^-?\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function accountNet(
  rows: Array<{ code: string; debit: string; credit: string }>,
  code: string,
): bigint {
  return rows
    .filter((row) => row.code === code)
    .reduce((sum, row) => sum + big(row.debit) - big(row.credit), 0n);
}

/** Posted GL slice for one lease tenant (and optional unit dimension). */
export async function loadGlLeaseEvidenceInTx(
  tx: Tx,
  orgId: string,
  input: { partyId: string; unitId?: string | null; chequeIds: string[] },
): Promise<GlLeaseEvidence> {
  const partyId = input.partyId;
  const unitId = input.unitId ?? null;

  const balanceRows = await tx
    .select({
      code: ledgerAccounts.code,
      debit: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
      credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        eq(journalEntries.status, 'posted'),
        eq(journalLines.partyId, partyId),
        inArray(ledgerAccounts.code, ['1200', '2100']),
        ...(unitId ? [eq(journalLines.unitId, unitId)] : []),
      ),
    )
    .groupBy(ledgerAccounts.code);

  const arOpen = accountNet(balanceRows, '1200');
  const depositHeld = balanceRows
    .filter((row) => row.code === '2100')
    .reduce((sum, row) => sum + big(row.credit) - big(row.debit), 0n);

  const paymentCredits = await tx
    .select({
      paymentId: journalEntries.sourceId,
      credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalLines.organizationId, orgId),
        eq(journalEntries.status, 'posted'),
        eq(journalEntries.sourceType, 'rent_payment'),
        eq(ledgerAccounts.code, '1200'),
        eq(journalLines.partyId, partyId),
        ...(unitId ? [eq(journalLines.unitId, unitId)] : []),
      ),
    )
    .groupBy(journalEntries.sourceId);

  const paymentIds = paymentCredits
    .map((row) => row.paymentId)
    .filter((id): id is string => Boolean(id));
  const paidByInvoiceId = new Map<string, string>();
  const paymentJournalIds = new Set(paymentIds);

  if (paymentIds.length) {
    const paymentRows = await tx
      .select({ id: payments.id, invoiceId: payments.invoiceId, amountMinor: payments.amountMinor })
      .from(payments)
      .where(and(eq(payments.organizationId, orgId), inArray(payments.id, paymentIds)));
    const creditByPayment = new Map(
      paymentCredits.map((row) => [row.paymentId!, big(row.credit)]),
    );
    for (const payment of paymentRows) {
      if (!payment.invoiceId) continue;
      const add = creditByPayment.get(payment.id) ?? payment.amountMinor;
      const prev = big(paidByInvoiceId.get(payment.invoiceId) ?? '0');
      paidByInvoiceId.set(payment.invoiceId, (prev + add).toString());
    }
  }

  const glBackedChequeIds = new Set<string>();
  if (input.chequeIds.length) {
    const ops = await tx
      .select({
        chequeId: chequeOperations.chequeId,
        operation: chequeOperations.operation,
        journalEntryId: chequeOperations.journalEntryId,
        journalStatus: journalEntries.status,
      })
      .from(chequeOperations)
      .leftJoin(journalEntries, eq(journalEntries.id, chequeOperations.journalEntryId))
      .where(
        and(
          eq(chequeOperations.organizationId, orgId),
          inArray(chequeOperations.chequeId, input.chequeIds),
          eq(chequeOperations.operation, 'collect'),
        ),
      );
    for (const op of ops) {
      if (op.journalEntryId && op.journalStatus === 'posted') {
        glBackedChequeIds.add(op.chequeId);
      }
    }
    const clearJournals = await tx
      .select({ sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          eq(journalEntries.status, 'posted'),
          eq(journalEntries.sourceType, 'cheque_clear'),
          inArray(journalEntries.sourceId, input.chequeIds),
        ),
      );
    for (const row of clearJournals) {
      if (row.sourceId) glBackedChequeIds.add(row.sourceId);
    }
  }

  return {
    arOpenMinor: arOpen.toString(),
    depositHeldMinor: (depositHeld > 0n ? depositHeld : 0n).toString(),
    paidByInvoiceId,
    glBackedChequeIds,
    paymentJournalIds,
  };
}
