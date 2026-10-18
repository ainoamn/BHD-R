import 'server-only';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  expenses,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  outboxEvents,
  payments,
  workflowEvents,
} from '@bhd-r/db';
import {
  AccountingBalanceError,
  DEFAULT_CHART_OF_ACCOUNTS,
  agingBucket,
  buildBalanceSheet,
  buildIncomeStatement,
  daysBetween,
  validateBalanced,
  type AgingReport,
  type CashFlowReport,
  type IncomeStatement,
  type JournalLineInput,
  type LedgerAccountType,
  type TrialBalanceRow,
} from '@/lib/accounting-gl';
import { withinViewerTenant } from '@/lib/portal-ops-data';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RESOURCE = 'fiscal_period';

function fail(code: string): never {
  throw new Error(code);
}

/** workflow_events.resource_id is UUID — derive a stable id from the fiscal range. */
function periodResourceId(from: string, to: string): string {
  const bytes = Buffer.from(
    createHash('sha256').update(`bhd-r:fiscal:${from}:${to}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canReadAccounting(claims: SessionClaims): boolean {
  return Boolean(claims.organizationId) && hasPermission(claims, 'accounting.read');
}

export function canManageAccounting(claims: SessionClaims): boolean {
  return Boolean(claims.organizationId) && hasPermission(claims, 'accounting.manage');
}

export function canPostAccounting(claims: SessionClaims): boolean {
  return (
    Boolean(claims.organizationId) &&
    (hasPermission(claims, 'accounting.post') || hasPermission(claims, 'accounting.manage'))
  );
}

async function allocateJournalReference(
  tx: Parameters<Parameters<typeof withinViewerTenant>[1]>[0],
  organizationId: string,
  occurredOn: string,
  kind: 'JRN' | 'REV',
): Promise<string> {
  const year = Number(occurredOn.slice(0, 4));
  const sequence = await tx.execute(sql<{ allocated: bigint }>`
    insert into journal_sequences (organization_id, year, kind, next_value)
    values (${organizationId}, ${year}, ${kind}, 2)
    on conflict (organization_id, year, kind)
    do update set next_value = journal_sequences.next_value + 1
    returning next_value - 1 as allocated
  `);
  const rows = rowsOf<{ allocated: bigint }>(sequence);
  const allocated = BigInt(String(rows[0]!.allocated));
  return `${kind}-${year}-${allocated.toString().padStart(6, '0')}`;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: T[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function assertPeriodOpen(
  tx: Parameters<Parameters<typeof withinViewerTenant>[1]>[0],
  organizationId: string,
  occurredOn: string,
) {
  if (!ISO_DATE.test(occurredOn)) fail('invalid_date');
  const locks = await tx
    .select({
      resourceId: workflowEvents.resourceId,
      eventType: workflowEvents.eventType,
      metadata: workflowEvents.metadata,
      occurredAt: workflowEvents.occurredAt,
    })
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.organizationId, organizationId),
        eq(workflowEvents.resourceType, PERIOD_RESOURCE),
      ),
    )
    .orderBy(desc(workflowEvents.occurredAt));
  const latest = new Map<string, { eventType: string; from: string; to: string }>();
  for (const row of locks) {
    if (latest.has(row.resourceId)) continue;
    const meta = (row.metadata ?? {}) as { from?: string; to?: string };
    if (!meta.from || !meta.to) continue;
    latest.set(row.resourceId, { eventType: row.eventType, from: meta.from, to: meta.to });
  }
  for (const period of latest.values()) {
    if (period.eventType !== 'period.locked') continue;
    if (occurredOn >= period.from && occurredOn <= period.to) fail('period_locked');
  }
}

export async function bootstrapChartOfAccounts(claims: SessionClaims) {
  if (!canManageAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    await tx
      .insert(ledgerAccounts)
      .values(
        DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
          organizationId: orgId,
          ...account,
          system: true,
        })),
      )
      .onConflictDoNothing({
        target: [ledgerAccounts.organizationId, ledgerAccounts.code],
      });
    return listAccountsInTx(tx, orgId);
  });
}

async function listAccountsInTx(
  tx: Parameters<Parameters<typeof withinViewerTenant>[1]>[0],
  orgId: string,
) {
  return tx
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      nameAr: ledgerAccounts.nameAr,
      nameEn: ledgerAccounts.nameEn,
      type: ledgerAccounts.type,
      currency: ledgerAccounts.currency,
      active: ledgerAccounts.active,
      system: ledgerAccounts.system,
      parentId: ledgerAccounts.parentId,
    })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.organizationId, orgId))
    .orderBy(asc(ledgerAccounts.code));
}

export async function listLedgerAccounts(claims: SessionClaims) {
  if (!canReadAccounting(claims)) fail('forbidden');
  return withinViewerTenant(claims, (tx) => listAccountsInTx(tx, claims.organizationId!));
}

export async function createLedgerAccount(
  claims: SessionClaims,
  input: {
    code: string;
    nameAr: string;
    nameEn: string;
    type: LedgerAccountType;
    parentId?: string;
    currency?: string;
  },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  const code = input.code.trim();
  if (!/^[0-9A-Za-z.-]{1,40}$/.test(code)) fail('invalid_code');
  if (input.nameAr.trim().length < 2 || input.nameEn.trim().length < 2) fail('invalid_name');
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .insert(ledgerAccounts)
      .values({
        organizationId: claims.organizationId!,
        code,
        nameAr: input.nameAr.trim().slice(0, 160),
        nameEn: input.nameEn.trim().slice(0, 160),
        type: input.type,
        parentId: input.parentId,
        currency: input.currency,
      })
      .returning({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        nameAr: ledgerAccounts.nameAr,
        nameEn: ledgerAccounts.nameEn,
        type: ledgerAccounts.type,
        active: ledgerAccounts.active,
        system: ledgerAccounts.system,
      });
    await tx.insert(workflowEvents).values({
      organizationId: claims.organizationId!,
      actorUserId: claims.sub,
      resourceType: 'ledger_account',
      resourceId: rows[0]!.id,
      eventType: 'account.created',
      toStatus: input.type,
      note: code,
    });
    return rows[0]!;
  });
}

export async function listJournals(claims: SessionClaims, limit = 100) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: journalEntries.id,
        reference: journalEntries.reference,
        occurredOn: journalEntries.occurredOn,
        description: journalEntries.description,
        status: journalEntries.status,
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
        postedAt: journalEntries.postedAt,
        reversalOfId: journalEntries.reversalOfId,
        createdAt: journalEntries.createdAt,
      })
      .from(journalEntries)
      .where(eq(journalEntries.organizationId, orgId))
      .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.createdAt))
      .limit(Math.min(Math.max(limit, 1), 300));
    if (!rows.length) return [];
    const totals = await tx
      .select({
        journalEntryId: journalLines.journalEntryId,
        currency: journalLines.currency,
        debitMinor: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
        creditMinor: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
      })
      .from(journalLines)
      .where(
        inArray(
          journalLines.journalEntryId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(journalLines.journalEntryId, journalLines.currency);
    return rows.map((row) => {
      const amounts = totals.filter((total) => total.journalEntryId === row.id);
      const single = amounts.length === 1 ? amounts[0]! : null;
      return {
        ...row,
        postedAt: row.postedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        amounts,
        currency: single?.currency ?? null,
        debitMinor: single?.debitMinor ?? null,
        creditMinor: single?.creditMinor ?? null,
      };
    });
  });
}

export async function getJournal(claims: SessionClaims, id: string) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
    });
    if (!entry) fail('not_found');
    const lines = await tx
      .select({
        id: journalLines.id,
        accountId: journalLines.accountId,
        partyId: journalLines.partyId,
        propertyId: journalLines.propertyId,
        unitId: journalLines.unitId,
        debitMinor: journalLines.debitMinor,
        creditMinor: journalLines.creditMinor,
        currency: journalLines.currency,
        memo: journalLines.memo,
        code: ledgerAccounts.code,
        nameAr: ledgerAccounts.nameAr,
        nameEn: ledgerAccounts.nameEn,
      })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalLines.journalEntryId, id))
      .orderBy(asc(journalLines.createdAt));
    return {
      ...entry,
      postedAt: entry.postedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      lines: lines.map((line) => ({
        ...line,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
      })),
    };
  });
}

export async function createJournal(
  claims: SessionClaims,
  input: {
    occurredOn: string;
    description: string;
    sourceType?: string;
    sourceId?: string;
    lines: JournalLineInput[];
    post?: boolean;
  },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(input.occurredOn)) fail('invalid_date');
  if (input.description.trim().length < 2) fail('invalid_description');
  try {
    validateBalanced(input.lines);
  } catch (error) {
    if (error instanceof AccountingBalanceError) fail('unbalanced');
    throw error;
  }
  const orgId = claims.organizationId!;
  const shouldPost = Boolean(input.post) && canPostAccounting(claims);
  return withinViewerTenant(claims, async (tx) => {
    await assertPeriodOpen(tx, orgId, input.occurredOn);
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
    const accountRows = await tx
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.organizationId, orgId), inArray(ledgerAccounts.id, accountIds)));
    if (accountRows.length !== accountIds.length) fail('account_missing');
    const entryRows = await tx
      .insert(journalEntries)
      .values({
        organizationId: orgId,
        reference: await allocateJournalReference(tx, orgId, input.occurredOn, 'JRN'),
        occurredOn: input.occurredOn,
        description: input.description.trim().slice(0, 500),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: shouldPost ? 'posted' : 'draft',
        postedByUserId: shouldPost ? claims.sub : undefined,
        postedAt: shouldPost ? new Date() : undefined,
      })
      .returning();
    const entry = entryRows[0]!;
    await tx.insert(journalLines).values(
      input.lines.map((line) => {
        const currency = (line.currency || 'OMR') as CurrencyCode;
        return {
          organizationId: orgId,
          journalEntryId: entry.id,
          accountId: line.accountId,
          partyId: line.partyId,
          propertyId: line.propertyId,
          unitId: line.unitId,
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          currency,
          minorUnit: currencyMinorUnits[currency] ?? 3,
          memo: line.memo?.slice(0, 500),
        };
      }),
    );
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'journal_entry',
      resourceId: entry.id,
      eventType: shouldPost ? 'journal.posted' : 'journal.created',
      toStatus: shouldPost ? 'posted' : 'draft',
    });
    if (shouldPost) {
      await tx.insert(outboxEvents).values({
        organizationId: orgId,
        topic: 'accounting.journal-posted',
        aggregateType: 'journal_entry',
        aggregateId: entry.id,
        payload: { reference: entry.reference },
      });
    }
    return {
      id: entry.id,
      reference: entry.reference,
      status: entry.status,
      occurredOn: entry.occurredOn,
    };
  });
}

export async function postJournal(claims: SessionClaims, id: string) {
  if (!canPostAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
    });
    if (!entry) fail('not_found');
    if (entry.status !== 'draft') fail('not_draft');
    await assertPeriodOpen(tx, orgId, entry.occurredOn);
    const lines = await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, id));
    try {
      validateBalanced(
        lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString(),
          currency: line.currency,
        })),
      );
    } catch {
      fail('unbalanced');
    }
    const rows = await tx
      .update(journalEntries)
      .set({
        status: 'posted',
        postedByUserId: claims.sub,
        postedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, id))
      .returning({
        id: journalEntries.id,
        reference: journalEntries.reference,
        status: journalEntries.status,
      });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'journal_entry',
      resourceId: id,
      eventType: 'journal.posted',
      fromStatus: 'draft',
      toStatus: 'posted',
    });
    await tx.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'accounting.journal-posted',
      aggregateType: 'journal_entry',
      aggregateId: id,
      payload: { reference: entry.reference },
    });
    return rows[0]!;
  });
}

export async function reverseJournal(
  claims: SessionClaims,
  id: string,
  occurredOn: string,
  note?: string,
) {
  if (!canPostAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(occurredOn)) fail('invalid_date');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    await assertPeriodOpen(tx, orgId, occurredOn);
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
    });
    if (!entry) fail('not_found');
    if (entry.status !== 'posted') fail('not_posted');
    const existing = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.organizationId, orgId), eq(journalEntries.reversalOfId, id)),
    });
    if (existing) fail('already_reversed');
    const sourceLines = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.journalEntryId, id));
    const reversalRows = await tx
      .insert(journalEntries)
      .values({
        organizationId: orgId,
        reference: await allocateJournalReference(tx, orgId, occurredOn, 'REV'),
        occurredOn,
        description: (note ?? `Reversal of ${entry.reference}`).slice(0, 500),
        status: 'posted',
        sourceType: 'journal_reversal',
        sourceId: id,
        reversalOfId: id,
        postedByUserId: claims.sub,
        postedAt: new Date(),
      })
      .returning({ id: journalEntries.id, reference: journalEntries.reference });
    const reversal = reversalRows[0]!;
    await tx.insert(journalLines).values(
      sourceLines.map((line) => ({
        organizationId: orgId,
        journalEntryId: reversal.id,
        accountId: line.accountId,
        partyId: line.partyId,
        propertyId: line.propertyId,
        unitId: line.unitId,
        debitMinor: line.creditMinor,
        creditMinor: line.debitMinor,
        currency: line.currency,
        minorUnit: line.minorUnit,
        memo: `Reversal: ${line.memo ?? entry.reference}`.slice(0, 500),
      })),
    );
    await tx
      .update(journalEntries)
      .set({ status: 'reversed', updatedAt: new Date() })
      .where(eq(journalEntries.id, id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'journal_entry',
      resourceId: id,
      eventType: 'journal.reversed',
      fromStatus: 'posted',
      toStatus: 'reversed',
      note,
    });
    return reversal;
  });
}

async function trialBalanceInTx(
  tx: Parameters<Parameters<typeof withinViewerTenant>[1]>[0],
  orgId: string,
  opts?: { fromDate?: string; toDate?: string; postedOnly?: boolean },
): Promise<TrialBalanceRow[]> {
  const fromDate = opts?.fromDate;
  const toDate = opts?.toDate;
  const postedOnly = opts?.postedOnly !== false;
  const dateFilter =
    fromDate && toDate
      ? sql`and je.occurred_on between ${fromDate} and ${toDate}`
      : toDate
        ? sql`and je.occurred_on <= ${toDate}`
        : sql``;
  const statusFilter = postedOnly ? sql`and je.status = 'posted'` : sql``;
  // Join posted (and dated) lines only — filters must live in the subquery, not after a bare lines join.
  const result = await tx.execute(sql<{
    account_id: string;
    code: string;
    name_ar: string;
    name_en: string;
    type: LedgerAccountType;
    currency: string | null;
    debit_minor: string;
    credit_minor: string;
    balance_minor: string;
  }>`
    select
      la.id as account_id,
      la.code,
      la.name_ar,
      la.name_en,
      la.type,
      posted.currency,
      coalesce(sum(posted.debit_minor), 0)::text as debit_minor,
      coalesce(sum(posted.credit_minor), 0)::text as credit_minor,
      coalesce(sum(posted.debit_minor - posted.credit_minor), 0)::text as balance_minor
    from ledger_accounts la
    left join (
      select jl.account_id, jl.currency, jl.debit_minor, jl.credit_minor
      from journal_lines jl
      inner join journal_entries je on je.id = jl.journal_entry_id
      where je.organization_id = ${orgId}
        ${statusFilter}
        ${dateFilter}
    ) posted on posted.account_id = la.id
    where la.organization_id = ${orgId}
    group by la.id, la.code, la.name_ar, la.name_en, la.type, posted.currency
    order by la.code
  `);
  return rowsOf<{
    account_id: string;
    code: string;
    name_ar: string;
    name_en: string;
    type: LedgerAccountType;
    currency: string | null;
    debit_minor: string;
    credit_minor: string;
    balance_minor: string;
  }>(result).map((row) => ({
    accountId: row.account_id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    type: row.type,
    currency: row.currency ?? 'OMR',
    debitMinor: row.debit_minor,
    creditMinor: row.credit_minor,
    balanceMinor: row.balance_minor,
  }));
}

export async function trialBalance(
  claims: SessionClaims,
  opts?: { fromDate?: string; toDate?: string },
) {
  if (!canReadAccounting(claims)) fail('forbidden');
  return withinViewerTenant(claims, (tx) =>
    trialBalanceInTx(tx, claims.organizationId!, { ...opts, postedOnly: true }),
  );
}

export async function incomeStatement(
  claims: SessionClaims,
  fromDate: string,
  toDate: string,
  currency = 'OMR',
): Promise<IncomeStatement> {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) fail('invalid_date');
  const rows = await withinViewerTenant(claims, (tx) =>
    trialBalanceInTx(tx, claims.organizationId!, { fromDate, toDate, postedOnly: true }),
  );
  return buildIncomeStatement(rows, fromDate, toDate, currency);
}

export async function balanceSheet(claims: SessionClaims, asOfDate: string, currency = 'OMR') {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(asOfDate)) fail('invalid_date');
  const yearStart = `${asOfDate.slice(0, 4)}-01-01`;
  return withinViewerTenant(claims, async (tx) => {
    const [allRows, periodRows] = await Promise.all([
      trialBalanceInTx(tx, claims.organizationId!, { toDate: asOfDate, postedOnly: true }),
      trialBalanceInTx(tx, claims.organizationId!, {
        fromDate: yearStart,
        toDate: asOfDate,
        postedOnly: true,
      }),
    ]);
    const income = buildIncomeStatement(periodRows, yearStart, asOfDate, currency);
    return buildBalanceSheet(allRows, asOfDate, currency, income.netIncomeMinor);
  });
}

export async function cashFlowReport(
  claims: SessionClaims,
  fromDate: string,
  toDate: string,
  currency = 'OMR',
): Promise<CashFlowReport> {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) fail('invalid_date');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const cashAccounts = await tx
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, orgId),
          inArray(ledgerAccounts.code, ['1000', '1100']),
        ),
      );
    const cashIds = cashAccounts.map((row) => row.id);
    if (!cashIds.length) {
      return {
        report: 'cashflow',
        fromDate,
        toDate,
        currency,
        inflowMinor: '0',
        outflowMinor: '0',
        netMinor: '0',
        lines: [],
      };
    }
    const lines = await tx
      .select({
        occurredOn: journalEntries.occurredOn,
        reference: journalEntries.reference,
        description: journalEntries.description,
        accountCode: ledgerAccounts.code,
        debitMinor: journalLines.debitMinor,
        creditMinor: journalLines.creditMinor,
        currency: journalLines.currency,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(
        and(
          eq(journalEntries.organizationId, orgId),
          eq(journalEntries.status, 'posted'),
          inArray(journalLines.accountId, cashIds),
          eq(journalLines.currency, currency),
          gte(journalEntries.occurredOn, fromDate),
          lte(journalEntries.occurredOn, toDate),
        ),
      )
      .orderBy(asc(journalEntries.occurredOn), asc(journalEntries.reference));
    let inflow = 0n;
    let outflow = 0n;
    const mapped = lines.map((line) => {
      inflow += line.debitMinor;
      outflow += line.creditMinor;
      return {
        occurredOn: line.occurredOn,
        reference: line.reference,
        description: line.description,
        accountCode: line.accountCode,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
      };
    });
    return {
      report: 'cashflow',
      fromDate,
      toDate,
      currency,
      inflowMinor: inflow.toString(),
      outflowMinor: outflow.toString(),
      netMinor: (inflow - outflow).toString(),
      lines: mapped,
    };
  });
}

export async function agingReceivables(
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
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        dueOn: invoices.dueOn,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          eq(invoices.currency, currency),
          inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
        ),
      )
      .orderBy(asc(invoices.dueOn));
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
        const outstanding = row.totalMinor - row.paidMinor;
        if (outstanding <= 0n) return null;
        const due = row.dueOn ?? asOfDate;
        const overdue = daysBetween(due, asOfDate);
        const bucket = agingBucket(overdue);
        total += outstanding;
        buckets[bucket] = (BigInt(buckets[bucket]) + outstanding).toString();
        return {
          invoiceId: row.id,
          invoiceNumber: row.invoiceNumber,
          dueOn: row.dueOn,
          daysOverdue: Math.max(0, overdue),
          bucket,
          outstandingMinor: outstanding.toString(),
          currency: row.currency,
        };
      })
      .filter(Boolean) as AgingReport['lines'];
    return {
      report: 'aging',
      ledger: 'ar',
      asOfDate,
      currency,
      totalOutstandingMinor: total.toString(),
      buckets,
      lines,
    };
  });
}

export async function listExpensesGl(claims: SessionClaims, limit = 80) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: expenses.id,
        reference: expenses.reference,
        category: expenses.category,
        description: expenses.description,
        amountMinor: expenses.amountMinor,
        taxMinor: expenses.taxMinor,
        currency: expenses.currency,
        status: expenses.status,
        issuedOn: expenses.issuedOn,
        dueOn: expenses.dueOn,
        propertyId: expenses.propertyId,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(eq(expenses.organizationId, orgId))
      .orderBy(desc(expenses.issuedOn), desc(expenses.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((row) => ({
      ...row,
      amountMinor: row.amountMinor.toString(),
      taxMinor: row.taxMinor.toString(),
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export async function createExpenseGl(
  claims: SessionClaims,
  input: {
    category: string;
    description: string;
    amountMinor: string;
    taxMinor?: string;
    currency: string;
    issuedOn: string;
    dueOn?: string;
    propertyId?: string;
    notes?: string;
  },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(input.issuedOn)) fail('invalid_date');
  if (!/^[1-9]\d*$/.test(input.amountMinor)) fail('invalid_amount');
  if (input.category.trim().length < 2 || input.description.trim().length < 2)
    fail('invalid_input');
  const currency = (input.currency || 'OMR') as CurrencyCode;
  const orgId = claims.organizationId!;
  const now = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .insert(expenses)
      .values({
        organizationId: orgId,
        reference: `EXP-${now}-${randomUUID().slice(0, 6).toUpperCase()}`,
        category: input.category.trim().slice(0, 80),
        description: input.description.trim().slice(0, 500),
        amountMinor: BigInt(input.amountMinor),
        taxMinor: BigInt(input.taxMinor ?? '0'),
        currency,
        minorUnit: currencyMinorUnits[currency] ?? 3,
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        propertyId: input.propertyId,
        notes: input.notes,
        status: 'pending',
      })
      .returning({
        id: expenses.id,
        reference: expenses.reference,
        status: expenses.status,
      });
    const row = rows[0]!;
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'expense',
      resourceId: row.id,
      eventType: 'expense.created',
      toStatus: row.status,
    });
    return row;
  });
}

export async function listFiscalPeriods(claims: SessionClaims) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const events = await tx
      .select({
        resourceId: workflowEvents.resourceId,
        eventType: workflowEvents.eventType,
        note: workflowEvents.note,
        metadata: workflowEvents.metadata,
        actorUserId: workflowEvents.actorUserId,
        occurredAt: workflowEvents.occurredAt,
      })
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.organizationId, orgId),
          eq(workflowEvents.resourceType, PERIOD_RESOURCE),
        ),
      )
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(200);
    const latest = new Map<
      string,
      { from: string; to: string; locked: boolean; note: string | null; at: string }
    >();
    for (const event of events) {
      if (latest.has(event.resourceId)) continue;
      const meta = (event.metadata ?? {}) as { from?: string; to?: string };
      if (!meta.from || !meta.to) continue;
      latest.set(event.resourceId, {
        from: meta.from,
        to: meta.to,
        locked: event.eventType === 'period.locked',
        note: event.note,
        at: event.occurredAt.toISOString(),
      });
    }
    return [...latest.entries()].map(([id, value]) => ({ id, ...value }));
  });
}

export async function setFiscalPeriodLock(
  claims: SessionClaims,
  input: { from: string; to: string; lock: boolean; note?: string },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(input.from) || !ISO_DATE.test(input.to) || input.from > input.to) {
    fail('invalid_date');
  }
  const resourceId = periodResourceId(input.from, input.to);
  return withinViewerTenant(claims, async (tx) => {
    await tx.insert(workflowEvents).values({
      organizationId: claims.organizationId!,
      actorUserId: claims.sub,
      resourceType: PERIOD_RESOURCE,
      resourceId,
      eventType: input.lock ? 'period.locked' : 'period.unlocked',
      toStatus: input.lock ? 'locked' : 'open',
      note: input.note?.slice(0, 500),
      metadata: { from: input.from, to: input.to },
    });
    return { id: resourceId, from: input.from, to: input.to, locked: input.lock };
  });
}

export async function listAccountingAudit(claims: SessionClaims, limit = 80) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: workflowEvents.id,
        resourceType: workflowEvents.resourceType,
        resourceId: workflowEvents.resourceId,
        eventType: workflowEvents.eventType,
        fromStatus: workflowEvents.fromStatus,
        toStatus: workflowEvents.toStatus,
        note: workflowEvents.note,
        actorUserId: workflowEvents.actorUserId,
        occurredAt: workflowEvents.occurredAt,
      })
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.organizationId, orgId),
          inArray(workflowEvents.resourceType, [
            'journal_entry',
            'ledger_account',
            'expense',
            PERIOD_RESOURCE,
          ]),
        ),
      )
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    }));
  });
}

export async function accountingDashboard(claims: SessionClaims) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const [receivable, collected, expenseTotal, draftJournals, overdue, accountCount, postedCount] =
      await Promise.all([
        tx
          .select({
            currency: invoices.currency,
            value: sql<string>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::text`,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, orgId),
              inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
            ),
          )
          .groupBy(invoices.currency),
        tx
          .select({
            currency: payments.currency,
            value: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)::text`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.organizationId, orgId),
              inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
            ),
          )
          .groupBy(payments.currency),
        tx
          .select({
            currency: expenses.currency,
            value: sql<string>`coalesce(sum(${expenses.amountMinor} + ${expenses.taxMinor}), 0)::text`,
          })
          .from(expenses)
          .where(
            and(
              eq(expenses.organizationId, orgId),
              inArray(expenses.status, ['approved', 'in_progress', 'completed']),
            ),
          )
          .groupBy(expenses.currency),
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(journalEntries)
          .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'draft'))),
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(invoices)
          .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, 'overdue'))),
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.organizationId, orgId)),
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(journalEntries)
          .where(
            and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'posted')),
          ),
      ]);
    const currencies = [
      ...new Set([...receivable, ...collected, ...expenseTotal].map((row) => row.currency)),
    ].sort();
    return {
      totalsByCurrency: currencies.map((currency) => ({
        currency,
        receivableMinor: receivable.find((row) => row.currency === currency)?.value ?? '0',
        collectedMinor: collected.find((row) => row.currency === currency)?.value ?? '0',
        expenseMinor: expenseTotal.find((row) => row.currency === currency)?.value ?? '0',
      })),
      draftJournals: Number(draftJournals[0]?.value ?? 0),
      overdueInvoices: Number(overdue[0]?.value ?? 0),
      accountCount: Number(accountCount[0]?.value ?? 0),
      postedJournals: Number(postedCount[0]?.value ?? 0),
      capabilities: {
        manage: canManageAccounting(claims),
        post: canPostAccounting(claims),
      },
    };
  });
}
