import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import {
  bankReconciliations,
  expenses,
  journalEntries,
  journalLines,
  ledgerAccounts,
  properties,
  vendors,
} from '@bhd-r/db';
import {
  agingBucket,
  type AgingReport,
  type JournalLineInput,
} from '@/lib/accounting-gl';
import {
  canManageAccounting,
  canPostAccounting,
  canReadAccounting,
  ensureAccountCodeMap,
  fail,
  postSourceDocumentInTx,
  setFiscalPeriodLock,
  type GlTx,
} from '@/lib/accounting-gl-neon';
import { muscatToday } from '@/lib/contract-list-facets';
import { withinViewerTenant } from '@/lib/portal-ops-data';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000);
}

/** AP aging from unpaid / pending expenses (vendor bills). */
export async function agingPayables(
  claims: SessionClaims,
  asOfDate: string,
  currency = 'OMR',
): Promise<AgingReport> {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(asOfDate)) fail('invalid_date');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: expenses.id,
        reference: expenses.reference,
        dueOn: expenses.dueOn,
        issuedOn: expenses.issuedOn,
        currency: expenses.currency,
        amountMinor: expenses.amountMinor,
        taxMinor: expenses.taxMinor,
        status: expenses.status,
        vendorName: vendors.name,
      })
      .from(expenses)
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(
        and(
          eq(expenses.organizationId, orgId),
          eq(expenses.currency, currency),
          inArray(expenses.status, ['pending', 'approved']),
          isNull(expenses.paidAt),
        ),
      )
      .orderBy(asc(expenses.dueOn), asc(expenses.issuedOn));
    const buckets: AgingReport['buckets'] = {
      current: '0',
      '1-30': '0',
      '31-60': '0',
      '61-90': '0',
      '90+': '0',
    };
    let total = 0n;
    const lines = rows
      .map((row) => {
        const outstanding = row.amountMinor + row.taxMinor;
        if (outstanding <= 0n) return null;
        const due = String(row.dueOn ?? row.issuedOn ?? asOfDate);
        const overdue = daysBetween(due, asOfDate);
        const bucket = agingBucket(overdue);
        total += outstanding;
        buckets[bucket] = (BigInt(buckets[bucket]) + outstanding).toString();
        return {
          invoiceId: row.id,
          invoiceNumber: row.reference + (row.vendorName ? ` · ${row.vendorName}` : ''),
          dueOn: due,
          daysOverdue: Math.max(0, overdue),
          bucket,
          outstandingMinor: outstanding.toString(),
          currency: row.currency,
        };
      })
      .filter(Boolean) as AgingReport['lines'];
    return {
      report: 'aging',
      ledger: 'ap',
      asOfDate,
      currency,
      totalOutstandingMinor: total.toString(),
      buckets,
      lines,
    };
  });
}

/** Oman VAT control account: output 2200 vs input 1400 for a period. */
export async function vatControlReport(
  claims: SessionClaims,
  fromDate: string,
  toDate: string,
  currency = 'OMR',
) {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) fail('invalid_date');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        code: ledgerAccounts.code,
        nameAr: ledgerAccounts.nameAr,
        nameEn: ledgerAccounts.nameEn,
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
          eq(journalLines.currency, currency),
          gte(journalEntries.occurredOn, fromDate),
          lte(journalEntries.occurredOn, toDate),
          inArray(ledgerAccounts.code, ['1400', '2200']),
        ),
      )
      .groupBy(ledgerAccounts.code, ledgerAccounts.nameAr, ledgerAccounts.nameEn);

    let inputVat = 0n;
    let outputVat = 0n;
    const accounts = rows.map((row) => {
      const debit = BigInt(row.debit);
      const credit = BigInt(row.credit);
      if (row.code === '1400') inputVat = debit - credit;
      if (row.code === '2200') outputVat = credit - debit;
      return {
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        debitMinor: row.debit,
        creditMinor: row.credit,
        balanceMinor: (debit - credit).toString(),
      };
    });
    const netPayable = outputVat - inputVat;
    return {
      report: 'vat',
      fromDate,
      toDate,
      currency,
      inputVatMinor: inputVat.toString(),
      outputVatMinor: outputVat.toString(),
      netPayableMinor: netPayable.toString(),
      accounts,
      noteAr:
        'ملخص حسابات الضريبة للفترة — يطابق منطق إقرار جهاز الضرائب (مخرجات − مدخلات). الإيجار السكني المعفى لا يظهر في 2200.',
      noteEn:
        'VAT control for the period — output − input, aligned with Oman Tax Authority return logic. Exempt residential rent does not hit 2200.',
    };
  });
}

/** Property owner operating statement: revenue − expenses by property (dimensional GL). */
export async function ownerPropertyStatement(
  claims: SessionClaims,
  fromDate: string,
  toDate: string,
  currency = 'OMR',
) {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) fail('invalid_date');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        propertyId: journalLines.propertyId,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        type: ledgerAccounts.type,
        debit: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
        credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .leftJoin(properties, eq(properties.id, journalLines.propertyId))
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          eq(journalEntries.status, 'posted'),
          eq(journalLines.currency, currency),
          gte(journalEntries.occurredOn, fromDate),
          lte(journalEntries.occurredOn, toDate),
          inArray(ledgerAccounts.type, ['revenue', 'expense']),
          sql`${journalLines.propertyId} is not null`,
        ),
      )
      .groupBy(
        journalLines.propertyId,
        properties.nameAr,
        properties.nameEn,
        ledgerAccounts.type,
      );

    const byProperty = new Map<
      string,
      {
        propertyId: string;
        nameAr: string;
        nameEn: string;
        revenueMinor: bigint;
        expenseMinor: bigint;
      }
    >();
    for (const row of rows) {
      if (!row.propertyId) continue;
      const current = byProperty.get(row.propertyId) ?? {
        propertyId: row.propertyId,
        nameAr: row.propertyNameAr || '—',
        nameEn: row.propertyNameEn || '—',
        revenueMinor: 0n,
        expenseMinor: 0n,
      };
      const debit = BigInt(row.debit);
      const credit = BigInt(row.credit);
      if (row.type === 'revenue') current.revenueMinor += credit - debit;
      else current.expenseMinor += debit - credit;
      byProperty.set(row.propertyId, current);
    }
    const propertiesOut = [...byProperty.values()]
      .map((row) => ({
        propertyId: row.propertyId,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        revenueMinor: row.revenueMinor.toString(),
        expenseMinor: row.expenseMinor.toString(),
        netMinor: (row.revenueMinor - row.expenseMinor).toString(),
      }))
      .sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
    const totals = propertiesOut.reduce(
      (acc, row) => {
        acc.revenue += BigInt(row.revenueMinor);
        acc.expense += BigInt(row.expenseMinor);
        return acc;
      },
      { revenue: 0n, expense: 0n },
    );
    return {
      report: 'owner',
      fromDate,
      toDate,
      currency,
      totalRevenueMinor: totals.revenue.toString(),
      totalExpenseMinor: totals.expense.toString(),
      netMinor: (totals.revenue - totals.expense).toString(),
      properties: propertiesOut,
    };
  });
}

/**
 * Year-end close (IFRS / PM standard):
 * 1) Post closing lines that zero every revenue/expense balance into retained earnings 3100
 *    (Dr revenue / Cr 3100 and Dr 3100 / Cr expense) so 4xxx/5xxx net to zero for the year.
 * 2) Lock the calendar year so post, reverse, and unpost into that range are refused.
 */
export async function closeFiscalYear(
  claims: SessionClaims,
  year: number,
  note?: string,
) {
  if (!canManageAccounting(claims) || !canPostAccounting(claims)) fail('forbidden');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('invalid_date');
  const orgId = claims.organizationId!;
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const sourceId = `year-close-${year}`;

  return withinViewerTenant(claims, async (tx) => {
    const existing = await tx.query.journalEntries.findFirst({
      where: and(
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.sourceType, 'year_close'),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, 'posted'),
      ),
      columns: { id: true },
    });
    if (existing) fail('already_closed');

    const map = await ensureAccountCodeMap(tx, orgId);
    const retainedId = map.get('3100');
    if (!retainedId) fail('account_missing');

    const balances = await tx
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        type: ledgerAccounts.type,
        debit: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
        credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
        currency: journalLines.currency,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.occurredOn, fromDate),
          lte(journalEntries.occurredOn, toDate),
          inArray(ledgerAccounts.type, ['revenue', 'expense']),
          ne(journalEntries.sourceType, 'year_close'),
        ),
      )
      .groupBy(ledgerAccounts.id, ledgerAccounts.code, ledgerAccounts.type, journalLines.currency);

    const byCurrency = new Map<string, JournalLineInput[]>();
    let netAll = 0n;
    for (const row of balances) {
      const debit = BigInt(row.debit);
      const credit = BigInt(row.credit);
      const lines = byCurrency.get(row.currency) ?? [];
      if (row.type === 'revenue') {
        const bal = credit - debit;
        if (bal === 0n) continue;
        // Close revenue: Dr revenue, Cr retained earnings
        lines.push({
          accountId: row.accountId,
          debitMinor: bal > 0n ? bal.toString() : '0',
          creditMinor: bal < 0n ? (-bal).toString() : '0',
          currency: row.currency,
          memo: `إقفال ${year} · ${row.code}`,
        });
        lines.push({
          accountId: retainedId,
          debitMinor: bal < 0n ? (-bal).toString() : '0',
          creditMinor: bal > 0n ? bal.toString() : '0',
          currency: row.currency,
          memo: `أرباح محتجزة ${year}`,
        });
        netAll += bal;
      } else {
        const bal = debit - credit;
        if (bal === 0n) continue;
        // Close expense: Dr retained earnings, Cr expense
        lines.push({
          accountId: retainedId,
          debitMinor: bal > 0n ? bal.toString() : '0',
          creditMinor: bal < 0n ? (-bal).toString() : '0',
          currency: row.currency,
          memo: `أرباح محتجزة ${year}`,
        });
        lines.push({
          accountId: row.accountId,
          debitMinor: bal < 0n ? (-bal).toString() : '0',
          creditMinor: bal > 0n ? bal.toString() : '0',
          currency: row.currency,
          memo: `إقفال ${year} · ${row.code}`,
        });
        netAll -= bal;
      }
      byCurrency.set(row.currency, lines);
    }

    const allLines = [...byCurrency.values()].flat();
    if (!allLines.length) fail('nothing_to_close');

    const posted = await postSourceDocumentInTx(tx, {
      organizationId: orgId,
      actorUserId: claims.sub,
      occurredOn: toDate,
      description: (note?.trim() || `إقفال السنة المالية ${year} → أرباح محتجزة`).slice(0, 500),
      sourceType: 'year_close',
      sourceId,
      lines: allLines,
    });

    return {
      year,
      fromDate,
      toDate,
      journalId: posted.id,
      netIncomeMinor: netAll.toString(),
      locked: true,
    };
  }).then(async (result) => {
    await setFiscalPeriodLock(claims, {
      from: fromDate,
      to: toDate,
      lock: true,
      note: note?.trim() || `Year close ${year}`,
    });
    return result;
  });
}

export async function listBankReconciliations(claims: SessionClaims) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select()
      .from(bankReconciliations)
      .where(eq(bankReconciliations.organizationId, orgId))
      .orderBy(desc(bankReconciliations.statementOn))
      .limit(40);
    return rows.map((row) => ({
      id: row.id,
      accountCode: row.accountCode,
      statementOn: String(row.statementOn),
      statementBalanceMinor: row.statementBalanceMinor.toString(),
      currency: row.currency,
      status: row.status,
      notes: row.notes,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

/** Open bank lines (account 1100 by default) not yet reconciled. */
export async function listUnreconciledBankLines(
  claims: SessionClaims,
  accountCode = '1100',
  currency = 'OMR',
) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const account = await tx.query.ledgerAccounts.findFirst({
      where: and(
        eq(ledgerAccounts.organizationId, orgId),
        eq(ledgerAccounts.code, accountCode),
      ),
      columns: { id: true, code: true, nameAr: true, nameEn: true },
    });
    if (!account) return { account: null, bookBalanceMinor: '0', lines: [] as const };

    const balanceRows = await tx
      .select({
        debit: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
        credit: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          eq(journalLines.accountId, account.id),
          eq(journalEntries.status, 'posted'),
          eq(journalLines.currency, currency),
        ),
      );
    const book =
      BigInt(balanceRows[0]?.debit ?? '0') - BigInt(balanceRows[0]?.credit ?? '0');

    const lines = await tx
      .select({
        id: journalLines.id,
        journalEntryId: journalLines.journalEntryId,
        occurredOn: journalEntries.occurredOn,
        reference: journalEntries.reference,
        description: journalEntries.description,
        debitMinor: journalLines.debitMinor,
        creditMinor: journalLines.creditMinor,
        memo: journalLines.memo,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(
        and(
          eq(journalLines.organizationId, orgId),
          eq(journalLines.accountId, account.id),
          eq(journalEntries.status, 'posted'),
          eq(journalLines.currency, currency),
          isNull(journalLines.reconciledAt),
        ),
      )
      .orderBy(asc(journalEntries.occurredOn), asc(journalLines.createdAt))
      .limit(500);

    return {
      account: {
        id: account.id,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
      },
      bookBalanceMinor: book.toString(),
      lines: lines.map((row) => ({
        id: row.id,
        journalEntryId: row.journalEntryId,
        occurredOn: String(row.occurredOn),
        reference: row.reference,
        description: row.description,
        debitMinor: row.debitMinor.toString(),
        creditMinor: row.creditMinor.toString(),
        memo: row.memo,
      })),
    };
  });
}

export async function completeBankReconciliation(
  claims: SessionClaims,
  input: {
    statementOn: string;
    statementBalanceMinor: string;
    currency?: string;
    accountCode?: string;
    lineIds: string[];
    notes?: string;
  },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(input.statementOn)) fail('invalid_date');
  if (!/^-?\d+$/.test(input.statementBalanceMinor)) fail('invalid_amount');
  const lineIds = [...new Set(input.lineIds.filter((id) => UUID.test(id)))].slice(0, 500);
  const orgId = claims.organizationId!;
  const currency = (input.currency || 'OMR').toUpperCase().slice(0, 3);
  const accountCode = (input.accountCode || '1100').slice(0, 16);

  return withinViewerTenant(claims, async (tx) => {
    const reconId = randomUUID();
    await tx.insert(bankReconciliations).values({
      id: reconId,
      organizationId: orgId,
      accountCode,
      statementOn: input.statementOn,
      statementBalanceMinor: BigInt(input.statementBalanceMinor),
      currency,
      status: 'completed',
      notes: input.notes?.slice(0, 2000),
      completedAt: new Date(),
      actorUserId: claims.sub,
    });
    if (lineIds.length) {
      await tx
        .update(journalLines)
        .set({
          reconciledAt: new Date(),
          reconciliationId: reconId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(journalLines.organizationId, orgId),
            inArray(journalLines.id, lineIds),
            isNull(journalLines.reconciledAt),
          ),
        );
    }
    return { id: reconId, status: 'completed' as const, clearedCount: lineIds.length };
  });
}

/** Helper: post accrual invoice journal when settings.accrualBasis (used by rent/charge flows). */
export async function postAccrualInvoiceInTx(
  tx: GlTx,
  input: {
    organizationId: string;
    actorUserId: string;
    invoiceId: string;
    occurredOn: string;
    amountMinor: string;
    taxMinor?: string;
    currency: string;
    memo: string;
    partyId?: string;
    propertyId?: string;
    unitId?: string;
    revenueCode: '4000' | '4010' | '4200' | '4300';
  },
) {
  const { postingTenantInvoice } = await import('@/lib/accounting-posting');
  const map = await ensureAccountCodeMap(tx, input.organizationId);
  return postSourceDocumentInTx(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    occurredOn: input.occurredOn,
    description: `فاتورة ${input.memo}`.slice(0, 500),
    sourceType: 'invoice',
    sourceId: input.invoiceId,
    lines: postingTenantInvoice(
      map,
      input.amountMinor,
      {
        currency: input.currency,
        ...(input.partyId ? { partyId: input.partyId } : {}),
        ...(input.propertyId ? { propertyId: input.propertyId } : {}),
        ...(input.unitId ? { unitId: input.unitId } : {}),
      },
      input.revenueCode,
      input.memo,
      input.taxMinor,
    ),
  });
}

export { muscatToday };
