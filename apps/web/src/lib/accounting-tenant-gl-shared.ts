/**
 * Pure GL↔tenant statement reconciliation (client-safe / unit-testable).
 */
import type { LeaseStatement } from '@/lib/tenant-ledger';

export type GlLeaseEvidence = {
  arOpenMinor: string;
  depositHeldMinor: string;
  paidByInvoiceId: Map<string, string>;
  glBackedChequeIds: Set<string>;
  paymentJournalIds: Set<string>;
};

function big(value: string | null | undefined): bigint {
  if (!value || !/^-?\d+$/.test(value)) return 0n;
  return BigInt(value);
}

/**
 * Rebuild paid amounts on a lease statement from GL evidence.
 * Contract schedule stays for due dates/amounts; cash without a posted journal does not count.
 */
export function applyGlEvidenceToStatement(
  statement: LeaseStatement,
  evidence: GlLeaseEvidence,
): LeaseStatement & {
  glArOpenMinor: string;
  glDepositHeldMinor: string;
  statementArOpenMinor: string;
  arVarianceMinor: string;
} {
  const lines = statement.lines.map((line) => {
    let paid = 0n;
    const amount = big(line.amountMinor);
    if (line.chequeId && evidence.glBackedChequeIds.has(line.chequeId)) {
      paid =
        line.chequeStatus === 'partially_cleared' && big(line.paidMinor) > 0n
          ? big(line.paidMinor)
          : amount;
    } else if (line.invoiceId && evidence.paidByInvoiceId.has(line.invoiceId)) {
      paid = big(evidence.paidByInvoiceId.get(line.invoiceId));
    }
    if (paid > amount) paid = amount;
    const status =
      paid >= amount
        ? ('paid' as const)
        : paid > 0n
          ? ('partially_paid' as const)
          : line.status;
    return {
      ...line,
      paidMinor: paid.toString(),
      status:
        status === 'paid' || status === 'partially_paid'
          ? status
          : line.chequeStatus === 'under_collection' || line.chequeStatus === 'deposited'
            ? ('collecting' as const)
            : line.status,
    };
  });

  const counted = lines.filter((line) => !line.outsideTotal);
  const paidTotal = counted.reduce((sum, line) => sum + big(line.paidMinor), 0n);
  const statementArOpen = counted.reduce(
    (sum, line) => sum + big(line.amountMinor) - big(line.paidMinor),
    0n,
  );
  const next = counted.find(
    (line) => line.status !== 'paid' && line.status !== 'collecting',
  );

  const variance = statementArOpen - big(evidence.arOpenMinor);

  return {
    ...statement,
    lines,
    paidMinor: paidTotal.toString(),
    remainingMinor: (big(statement.contractTotalMinor) - paidTotal).toString(),
    nextDue: next
      ? {
          dueOn: next.dueOn,
          amountMinor: (big(next.amountMinor) - big(next.paidMinor)).toString(),
        }
      : null,
    glArOpenMinor: evidence.arOpenMinor,
    glDepositHeldMinor: evidence.depositHeldMinor,
    statementArOpenMinor: statementArOpen.toString(),
    arVarianceMinor: variance.toString(),
  };
}
