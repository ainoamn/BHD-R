/**
 * GL integrity board: unposted sources, AR vs statement variance, unbalanced drafts.
 * Read-only diagnostics for the audit / fin-dash workspace.
 */
import 'server-only';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  chequeOperations,
  cheques,
  contracts,
  invoices,
  journalEntries,
  journalLines,
  leases,
  payments,
  properties,
  units,
} from '@bhd-r/db';
import { canReadAccounting, fail } from '@/lib/accounting-gl-neon';
import {
  applyGlEvidenceToStatement,
  loadGlLeaseEvidenceInTx,
} from '@/lib/accounting-tenant-gl';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import type {
  IntegrityBoardPayload,
  IntegrityGap,
} from '@/lib/accounting-integrity-board';
import { muscatToday } from '@/lib/tenant-charges-neon';
import { buildLeaseStatement, ledgerTermsOf, withAlignedScheduleCheques } from '@/lib/tenant-ledger';

export type { IntegrityBoardPayload, IntegrityGap };

export async function loadAccountingIntegrityBoard(
  claims: SessionClaims,
): Promise<IntegrityBoardPayload> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    const gaps: IntegrityGap[] = [];

    const paymentRows = await tx
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status,
      })
      .from(payments)
      .where(
        and(eq(payments.organizationId, orgId), eq(payments.status, 'succeeded')),
      )
      .orderBy(desc(payments.receivedAt))
      .limit(200);

    if (paymentRows.length) {
      const paymentIds = paymentRows.map((row) => row.id);
      const posted = await tx
        .select({ sourceId: journalEntries.sourceId })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.sourceType, 'rent_payment'),
            eq(journalEntries.status, 'posted'),
            inArray(journalEntries.sourceId, paymentIds),
          ),
        );
      const postedSet = new Set(posted.map((row) => row.sourceId).filter(Boolean));
      for (const row of paymentRows) {
        if (postedSet.has(row.id)) continue;
        gaps.push({
          id: `pay-${row.id}`,
          kind: 'payment_unposted',
          labelAr: 'دفعة ناجحة بلا قيد مرحّل',
          labelEn: 'Succeeded payment without posted journal',
          amountMinor: row.amountMinor.toString(),
          currency: row.currency || 'OMR',
          ref: row.id.slice(0, 8),
        });
      }
    }

    const cleared = await tx
      .select({
        id: cheques.id,
        chequeNumber: cheques.chequeNumber,
        amountMinor: cheques.amountMinor,
        currency: cheques.currency,
        reviewStatus: cheques.reviewStatus,
      })
      .from(cheques)
      .where(
        and(
          eq(cheques.organizationId, orgId),
          inArray(cheques.reviewStatus, ['cleared', 'partially_cleared']),
        ),
      )
      .limit(200);

    if (cleared.length) {
      const ids = cleared.map((row) => row.id);
      const ops = await tx
        .select({
          chequeId: chequeOperations.chequeId,
          journalEntryId: chequeOperations.journalEntryId,
          journalStatus: journalEntries.status,
        })
        .from(chequeOperations)
        .leftJoin(journalEntries, eq(journalEntries.id, chequeOperations.journalEntryId))
        .where(
          and(
            eq(chequeOperations.organizationId, orgId),
            inArray(chequeOperations.chequeId, ids),
            eq(chequeOperations.operation, 'collect'),
          ),
        );
      const backed = new Set(
        ops
          .filter((row) => row.journalEntryId && row.journalStatus === 'posted')
          .map((row) => row.chequeId),
      );
      const legacy = await tx
        .select({ sourceId: journalEntries.sourceId })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.status, 'posted'),
            eq(journalEntries.sourceType, 'cheque_clear'),
            inArray(journalEntries.sourceId, ids),
          ),
        );
      for (const row of legacy) {
        if (row.sourceId) backed.add(row.sourceId);
      }
      for (const row of cleared) {
        if (backed.has(row.id)) continue;
        gaps.push({
          id: `chq-${row.id}`,
          kind: 'cheque_unposted',
          labelAr: `شيك محصّل بلا قيد تحصيل: ${row.chequeNumber}`,
          labelEn: `Cleared cheque without collect journal: ${row.chequeNumber}`,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency || 'OMR',
          ref: row.chequeNumber,
        });
      }
    }

    const leaseRows = await tx
      .select({
        id: leases.id,
        tenantPartyId: leases.tenantPartyId,
        unitId: leases.unitId,
        currency: leases.currency,
        leaseTerms: sql<unknown>`${contracts.payloadSnapshot}->'leaseTerms'`,
        contractAmountMinor: sql<
          string | null
        >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .leftJoin(contracts, eq(contracts.id, leases.contractId))
      .where(
        and(
          eq(leases.organizationId, orgId),
          inArray(leases.status, ['active', 'clearance_pending', 'ended']),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(80);

    const today = muscatToday();
    for (const lease of leaseRows) {
      const chequeRows = await tx
        .select({
          id: cheques.id,
          chequeNumber: cheques.chequeNumber,
          bankName: cheques.bankName,
          amountMinor: cheques.amountMinor,
          dueOn: cheques.dueOn,
          reviewStatus: cheques.reviewStatus,
        })
        .from(cheques)
        .where(and(eq(cheques.organizationId, orgId), eq(cheques.leaseId, lease.id)))
        .limit(80);
      const invoiceRows = await tx
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          status: invoices.status,
          issuedOn: invoices.issuedOn,
          dueOn: invoices.dueOn,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          billingPeriodStart: invoices.billingPeriodStart,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, orgId),
            eq(invoices.leaseId, lease.id),
            ne(invoices.status, 'draft'),
          ),
        )
        .limit(80);
      const parsed = ledgerTermsOf({ leaseTerms: lease.leaseTerms });
      const draft = buildLeaseStatement({
        terms: parsed ? withAlignedScheduleCheques(parsed, lease.id) : null,
        contractAmountMinor: lease.contractAmountMinor,
        cheques: chequeRows.map((cheque) => ({
          id: cheque.id,
          chequeNumber: cheque.chequeNumber,
          bankName: cheque.bankName,
          amountMinor: cheque.amountMinor.toString(),
          dueOn: String(cheque.dueOn),
          reviewStatus: cheque.reviewStatus,
        })),
        invoices: invoiceRows.map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          issuedOn: String(invoice.issuedOn),
          dueOn: String(invoice.dueOn),
          totalMinor: invoice.totalMinor.toString(),
          paidMinor: invoice.paidMinor.toString(),
          billingPeriodStart: invoice.billingPeriodStart
            ? String(invoice.billingPeriodStart)
            : null,
        })),
        today,
      });
      const evidence = await loadGlLeaseEvidenceInTx(tx, orgId, {
        partyId: lease.tenantPartyId,
        unitId: lease.unitId,
        chequeIds: chequeRows.map((cheque) => cheque.id),
      });
      const reconciled = applyGlEvidenceToStatement(draft, evidence);
      if (reconciled.arVarianceMinor !== '0') {
        gaps.push({
          id: `ar-${lease.id}`,
          kind: 'ar_variance',
          labelAr: 'فرق ذمم الكشف مقابل حساب 1200',
          labelEn: 'Statement AR vs GL 1200 variance',
          amountMinor: reconciled.arVarianceMinor,
          currency: lease.currency || 'OMR',
          ref: lease.id.slice(0, 8),
        });
      }
    }

    const drafts = await tx
      .select({
        id: journalEntries.id,
        reference: journalEntries.reference,
        debit: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
        credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
        currency: journalLines.currency,
      })
      .from(journalEntries)
      .leftJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'draft')))
      .groupBy(journalEntries.id, journalEntries.reference, journalLines.currency)
      .limit(50);
    for (const row of drafts) {
      if (row.debit === row.credit) continue;
      gaps.push({
        id: `dr-${row.id}`,
        kind: 'draft_unbalanced',
        labelAr: `مسودة غير متوازنة ${row.reference}`,
        labelEn: `Unbalanced draft ${row.reference}`,
        amountMinor: (
          BigInt(row.debit || '0') - BigInt(row.credit || '0')
        ).toString(),
        currency: row.currency || 'OMR',
        ref: row.reference,
      });
    }

    const summary = {
      paymentUnposted: gaps.filter((g) => g.kind === 'payment_unposted').length,
      chequeUnposted: gaps.filter((g) => g.kind === 'cheque_unposted').length,
      arVariance: gaps.filter((g) => g.kind === 'ar_variance').length,
      draftUnbalanced: gaps.filter((g) => g.kind === 'draft_unbalanced').length,
    };

    return { summary, gaps: gaps.slice(0, 120) };
  });
}
