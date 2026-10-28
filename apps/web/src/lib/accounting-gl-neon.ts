import 'server-only';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  approvalRequests,
  expenses,
  invoices,
  journalEntries,
  journalLines,
  leases,
  ledgerAccounts,
  outboxEvents,
  parties,
  payments,
  properties,
  reservations,
  stayBookings,
  stayPaymentIntents,
  stayProfiles,
  units,
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
import {
  canUnpostJournalSource,
  isProtectedJournalSource,
  normalizeAccountingSettings,
  type AccountingSettings,
  DEFAULT_ACCOUNTING_SETTINGS,
} from '@/lib/accounting-integrity';
import {
  expenseCodeFromCategory,
  postingDepositHeld,
  postingExpensePaid,
  postingRentReceipt,
  type AccountCodeMap,
} from '@/lib/accounting-posting';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import {
  buildFieldKeyring,
  decryptField,
  encryptField,
  looksLikeEncryptedField,
} from '@bhd-r/security';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RESOURCE = 'fiscal_period';
const SETTINGS_RESOURCE = 'accounting_settings';

function bankIbanKeyring() {
  return buildFieldKeyring('bank-iban');
}

function encryptBankIbans(orgId: string, settings: AccountingSettings): AccountingSettings {
  const keyring = bankIbanKeyring();
  return {
    ...settings,
    bankAccounts: settings.bankAccounts.map((row) => {
      const iban = row.iban?.trim() ?? '';
      if (!iban || looksLikeEncryptedField(iban)) return row;
      return {
        ...row,
        iban: encryptField(iban, keyring, `org:${orgId}:bank:${row.id}:iban`),
      };
    }),
  };
}

function decryptBankIbans(orgId: string, settings: AccountingSettings): AccountingSettings {
  const keyring = bankIbanKeyring();
  return {
    ...settings,
    bankAccounts: settings.bankAccounts.map((row) => {
      const iban = row.iban?.trim() ?? '';
      if (!iban || !looksLikeEncryptedField(iban)) return row;
      try {
        return {
          ...row,
          iban: decryptField(iban, keyring, `org:${orgId}:bank:${row.id}:iban`),
        };
      } catch {
        return { ...row, iban: '' };
      }
    }),
  };
}

export type GlTx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

export function fail(code: string): never {
  throw new Error(code);
}

/** Hisaby-compatible outbox payload for operational journals (pull remains source of full lines). */
function hisabyJournalPayload(input: {
  journalId: string;
  reference: string;
  occurredOn: string;
  description: string;
  amountMinor: string;
  currency?: string;
  sourceType?: string | null;
  sourceId?: string | null;
}) {
  return {
    reference: input.reference,
    journalId: input.journalId,
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'OMR',
    memo: input.description,
    occurredOn: input.occurredOn,
    direction: 'inbound' as const,
    accountLabel: 'BHD-R operational GL',
    sourceType: input.sourceType ?? undefined,
    sourceId: input.sourceId ?? undefined,
    sourceRefs: {
      journalId: input.journalId,
      ...(input.sourceType === 'invoice' && input.sourceId ? { invoiceId: input.sourceId } : {}),
      ...(input.sourceType === 'payment' && input.sourceId ? { paymentId: input.sourceId } : {}),
      ...(input.sourceType === 'stay_payment' && input.sourceId
        ? { paymentId: input.sourceId }
        : {}),
    },
  };
}

/** Stable UUID v5-like from a seed (journal source_id and fiscal period resource_id are uuid). */
export function deterministicSourceId(seed: string): string {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** workflow_events.resource_id is UUID — derive a stable id from the fiscal range. */
function periodResourceId(from: string, to: string): string {
  return deterministicSourceId(`bhd-r:fiscal:${from}:${to}`);
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
    const archived = await archivedIdSet(
      tx,
      orgId,
      'journal_entry',
      rows.map((row) => row.id),
    );
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
        archived: archived.has(row.id),
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
    const [lines, trail] = await Promise.all([
      tx
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
          partyName: parties.displayName,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
          unitCode: units.code,
        })
        .from(journalLines)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .leftJoin(parties, eq(parties.id, journalLines.partyId))
        .leftJoin(properties, eq(properties.id, journalLines.propertyId))
        .leftJoin(units, eq(units.id, journalLines.unitId))
        .where(eq(journalLines.journalEntryId, id))
        .orderBy(asc(journalLines.createdAt)),
      tx
        .select({
          id: workflowEvents.id,
          eventType: workflowEvents.eventType,
          fromStatus: workflowEvents.fromStatus,
          toStatus: workflowEvents.toStatus,
          note: workflowEvents.note,
          occurredAt: workflowEvents.occurredAt,
          actorUserId: workflowEvents.actorUserId,
        })
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.organizationId, orgId),
            eq(workflowEvents.resourceType, 'journal_entry'),
            eq(workflowEvents.resourceId, id),
          ),
        )
        .orderBy(desc(workflowEvents.occurredAt))
        .limit(40),
    ]);
    let debit = 0n;
    let credit = 0n;
    const mapped = lines.map((line) => {
      debit += line.debitMinor;
      credit += line.creditMinor;
      return {
        ...line,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
      };
    });
    const contactLine = lines.find((line) => line.partyId);
    const partyContact = contactLine?.partyId
      ? await tx.query.parties.findFirst({
          where: eq(parties.id, contactLine.partyId),
          columns: { email: true, phone: true, displayName: true },
        })
      : null;
    return {
      ...entry,
      postedAt: entry.postedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      totals: { debitMinor: debit.toString(), creditMinor: credit.toString() },
      lines: mapped,
      partyEmail: partyContact?.email ?? null,
      partyPhone: partyContact?.phone ?? null,
      partyName: partyContact?.displayName ?? contactLine?.partyName ?? null,
      trail: trail.map((row) => ({
        ...row,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  });
}

export type AccountingDocument = {
  id: string;
  kind: 'invoice' | 'receipt' | 'journal';
  reference: string;
  title: string;
  status: string;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  partyName: string | null;
  propertyLabel: string | null;
  journalId: string | null;
  note: string | null;
  sourceType?: string | null;
  archived?: boolean;
};

/** Invoices, stay receipts and source journals for the documents register. */
export async function listAccountingDocuments(
  claims: SessionClaims,
  limit = 80,
): Promise<AccountingDocument[]> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const cap = Math.min(Math.max(limit, 1), 200);
  return withinViewerTenant(claims, async (tx) => {
    const [invoiceRows, stayRows, journalDocs, journalBySource] = await Promise.all([
      tx
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          status: invoices.status,
          currency: invoices.currency,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          issuedOn: invoices.issuedOn,
          notes: invoices.notes,
          tenantName: parties.displayName,
          propertyNameAr: properties.nameAr,
          unitCode: units.code,
        })
        .from(invoices)
        .leftJoin(parties, eq(parties.id, invoices.tenantPartyId))
        .leftJoin(leases, eq(leases.id, invoices.leaseId))
        .leftJoin(units, eq(units.id, leases.unitId))
        .leftJoin(properties, eq(properties.id, units.propertyId))
        .where(eq(invoices.organizationId, orgId))
        .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt))
        .limit(cap),
      tx
        .select({
          id: stayPaymentIntents.id,
          amountMinor: stayPaymentIntents.amountMinor,
          currency: stayPaymentIntents.currency,
          status: stayPaymentIntents.status,
          at: stayPaymentIntents.updatedAt,
          referenceCode: stayBookings.referenceCode,
          propertyNameAr: properties.nameAr,
          unitCode: units.code,
        })
        .from(stayPaymentIntents)
        .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
        .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
        .innerJoin(units, eq(units.id, stayBookings.unitId))
        .where(
          and(
            eq(stayPaymentIntents.organizationId, orgId),
            eq(stayPaymentIntents.status, 'succeeded'),
          ),
        )
        .orderBy(desc(stayPaymentIntents.updatedAt))
        .limit(cap),
      tx
        .select({
          id: journalEntries.id,
          reference: journalEntries.reference,
          description: journalEntries.description,
          status: journalEntries.status,
          occurredOn: journalEntries.occurredOn,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
        })
        .from(journalEntries)
        .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'posted')))
        .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.createdAt))
        .limit(cap),
      tx
        .select({
          id: journalEntries.id,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.organizationId, orgId),
            sql`${journalEntries.sourceType} is not null`,
            sql`${journalEntries.sourceId} is not null`,
          ),
        )
        .limit(500),
    ]);

    const sourceJournal = new Map<string, string>();
    for (const row of journalBySource) {
      if (row.sourceType && row.sourceId) {
        sourceJournal.set(`${row.sourceType}:${row.sourceId}`, row.id);
      }
    }

    const docs: AccountingDocument[] = [];
    for (const row of invoiceRows) {
      const paid = row.paidMinor > 0n;
      docs.push({
        id: row.id,
        kind: paid ? 'receipt' : 'invoice',
        reference: row.number,
        title: paid
          ? row.tenantName
            ? `إيصال قبض — ${row.tenantName}`
            : 'إيصال قبض'
          : row.tenantName
            ? `فاتورة مطالبة — ${row.tenantName}`
            : 'فاتورة مطالبة',
        status: row.status,
        amountMinor: paid ? row.paidMinor.toString() : row.totalMinor.toString(),
        currency: row.currency,
        occurredOn: row.issuedOn,
        partyName: row.tenantName,
        propertyLabel: [row.propertyNameAr, row.unitCode].filter(Boolean).join(' / ') || null,
        journalId: sourceJournal.get(`rent_payment:${row.id}`) ?? null,
        note: row.notes,
        sourceType: paid ? 'rent_payment' : 'invoice',
      });
    }
    for (const row of stayRows) {
      docs.push({
        id: row.id,
        kind: 'receipt',
        reference: row.referenceCode,
        title: `إيصال إقامة — ${row.referenceCode}`,
        status: row.status,
        amountMinor: row.amountMinor.toString(),
        currency: row.currency,
        occurredOn: row.at.toISOString().slice(0, 10),
        partyName: null,
        propertyLabel: [row.propertyNameAr, row.unitCode].filter(Boolean).join(' / '),
        journalId: sourceJournal.get(`stay_payment:${row.id}`) ?? null,
        note: null,
        sourceType: 'stay_payment',
      });
    }
    for (const row of journalDocs) {
      docs.push({
        id: row.id,
        kind: 'journal',
        reference: row.reference,
        title: row.description,
        status: row.status,
        amountMinor: '0',
        currency: 'OMR',
        occurredOn: row.occurredOn,
        partyName: null,
        /** Keep source type code; UI localizes it — never show raw snake_case as property. */
        propertyLabel: row.sourceType,
        journalId: row.id,
        note: null,
        sourceType: row.sourceType,
      });
    }
    docs.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
    const page = docs.slice(0, cap);
    const invoiceIds = page.filter((row) => row.kind !== 'journal').map((row) => row.id);
    const journalIds = page.filter((row) => row.kind === 'journal').map((row) => row.id);
    const [archivedInvoices, archivedJournals] = await Promise.all([
      archivedIdSet(tx, orgId, 'invoice', invoiceIds),
      archivedIdSet(tx, orgId, 'journal_entry', journalIds),
    ]);
    return page.map((row) => ({
      ...row,
      archived:
        row.kind === 'journal' ? archivedJournals.has(row.id) : archivedInvoices.has(row.id),
    }));
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
  const amountMinor = input.lines
    .reduce((sum, line) => sum + BigInt(line.debitMinor || '0'), 0n)
    .toString();
  const created = await withinViewerTenant(claims, async (tx) => {
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
        payload: hisabyJournalPayload({
          journalId: entry.id,
          reference: entry.reference,
          occurredOn: entry.occurredOn,
          description: entry.description,
          amountMinor,
          ...(input.sourceType ? { sourceType: input.sourceType } : {}),
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        }),
      });
    }
    return {
      id: entry.id,
      reference: entry.reference,
      status: entry.status,
      occurredOn: entry.occurredOn,
    };
  });
  if (shouldPost) {
    void import('@/lib/accounting-send-neon')
      .then(({ notifyPartyOnJournalPosted }) => notifyPartyOnJournalPosted(claims, created.id))
      .catch(() => undefined);
  }
  return created;
}

export async function postJournal(claims: SessionClaims, id: string) {
  if (!canPostAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const posted = await withinViewerTenant(claims, async (tx) => {
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
    const amountMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0n).toString();
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
      payload: hisabyJournalPayload({
        journalId: id,
        reference: entry.reference,
        occurredOn: entry.occurredOn,
        description: entry.description,
        amountMinor,
        ...(entry.sourceType ? { sourceType: entry.sourceType } : {}),
        ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
      }),
    });
    return rows[0]!;
  });
  void import('@/lib/accounting-send-neon')
    .then(({ notifyPartyOnJournalPosted }) => notifyPartyOnJournalPosted(claims, id))
    .catch(() => undefined);
  return posted;
}

export async function reverseJournal(
  claims: SessionClaims,
  id: string,
  occurredOn: string,
  note?: string,
  opts?: { refundConfirmed?: boolean; approvalId?: string },
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

    const settings = await readAccountingSettingsInTx(tx, orgId);
    const protectedSource = isProtectedJournalSource(entry.sourceType);
    let reason = (note ?? '').trim();
    if (protectedSource) {
      if (settings.requireSecondApproverForOnline && opts?.approvalId) {
        const approvalRows = await tx
          .select({ decisionNote: approvalRequests.decisionNote })
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.id, opts.approvalId),
              eq(approvalRequests.organizationId, orgId),
              eq(approvalRequests.resourceId, id),
            ),
          )
          .limit(1);
        const approvalNote = approvalRows[0]?.decisionNote?.trim();
        if (approvalNote && reason.length < 8) reason = approvalNote;
      }
      if (reason.length < 8) fail('reason_required');
      if (settings.requireRefundConfirmForOnline && !opts?.refundConfirmed) {
        fail('refund_confirm_required');
      }
      if (settings.requireSecondApproverForOnline) {
        if (opts?.approvalId) {
          await assertApprovedJournalReverse(tx, claims, orgId, id, opts.approvalId);
        } else {
          const approvalId = await createJournalReverseApproval(
            tx,
            orgId,
            claims.sub,
            entry,
            reason,
          );
          fail(`approval_required:${approvalId}`);
        }
      } else if (!canManageAccounting(claims)) {
        fail('forbidden');
      } else {
        await tx.insert(approvalRequests).values({
          organizationId: orgId,
          reference: `JR-${entry.reference}-${Date.now().toString(36)}`.slice(0, 64),
          type: 'journal_reverse',
          subject: `عكس معتمد: ${entry.reference} — ${reason}`.slice(0, 240),
          resourceType: 'journal_entry',
          resourceId: id,
          requestedByUserId: claims.sub,
          assignedToUserId: claims.sub,
          status: 'approved',
          decisionNote: reason.slice(0, 500),
          decidedAt: new Date(),
        });
      }
    }

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
        description: (reason || note || `عكس القيد ${entry.reference}`).slice(0, 500),
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
        memo: `عكس: ${line.memo ?? entry.reference}`.slice(0, 500),
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
      note: reason || note,
      metadata: {
        protected: protectedSource,
        refundConfirmed: Boolean(opts?.refundConfirmed),
        sourceType: entry.sourceType,
        approvalId: opts?.approvalId ?? null,
      },
    });
    return reversal;
  });
}

async function createJournalReverseApproval(
  tx: GlTx,
  orgId: string,
  actorUserId: string,
  entry: { id: string; reference: string },
  reason: string,
) {
  const pendingRows = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.organizationId, orgId),
        eq(approvalRequests.resourceType, 'journal_entry'),
        eq(approvalRequests.resourceId, entry.id),
        eq(approvalRequests.type, 'journal_reverse'),
        eq(approvalRequests.status, 'pending'),
      ),
    )
    .limit(1);
  const pending = pendingRows[0];
  if (pending) fail(`approval_required:${pending.id}`);
  const rows = await tx
    .insert(approvalRequests)
    .values({
      organizationId: orgId,
      reference: `JR-${entry.reference}-${Date.now().toString(36)}`.slice(0, 64),
      type: 'journal_reverse',
      subject: `طلب عكس قيد إلكتروني ${entry.reference}: ${reason}`.slice(0, 240),
      resourceType: 'journal_entry',
      resourceId: entry.id,
      requestedByUserId: actorUserId,
      status: 'pending',
      decisionNote: reason.slice(0, 500),
    })
    .returning({ id: approvalRequests.id });
  return rows[0]!.id;
}

async function assertApprovedJournalReverse(
  tx: GlTx,
  claims: SessionClaims,
  orgId: string,
  journalId: string,
  approvalId: string,
) {
  const rows = await tx
    .select({
      status: approvalRequests.status,
      requestedByUserId: approvalRequests.requestedByUserId,
      decisionNote: approvalRequests.decisionNote,
    })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, approvalId),
        eq(approvalRequests.organizationId, orgId),
        eq(approvalRequests.resourceType, 'journal_entry'),
        eq(approvalRequests.resourceId, journalId),
        eq(approvalRequests.type, 'journal_reverse'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) fail('not_found');
  if (row.status === 'pending') {
    if (row.requestedByUserId === claims.sub) fail('approval_pending');
    if (!hasPermission(claims, 'approval.decide')) fail('forbidden');
    await tx
      .update(approvalRequests)
      .set({
        status: 'approved',
        assignedToUserId: claims.sub,
        decidedAt: new Date(),
        decisionNote: row.decisionNote,
      })
      .where(eq(approvalRequests.id, approvalId));
    return;
  }
  if (row.status !== 'approved') fail('approval_pending');
}

/** Second approver confirms a pending electronic reverse, then posts the reversing entry. */
export async function approveAndReverseJournal(
  claims: SessionClaims,
  id: string,
  approvalId: string,
  occurredOn: string,
  note?: string,
) {
  if (!canPostAccounting(claims) || !hasPermission(claims, 'approval.decide')) fail('forbidden');
  return reverseJournal(claims, id, occurredOn, note, {
    refundConfirmed: true,
    approvalId,
  });
}

async function archivedIdSet(
  tx: GlTx,
  orgId: string,
  resourceType: string,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx
    .select({
      resourceId: workflowEvents.resourceId,
      eventType: workflowEvents.eventType,
    })
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.organizationId, orgId),
        eq(workflowEvents.resourceType, resourceType),
        inArray(workflowEvents.resourceId, ids),
        inArray(workflowEvents.eventType, ['accounting.archived', 'accounting.restored']),
      ),
    )
    .orderBy(desc(workflowEvents.occurredAt));
  const seen = new Set<string>();
  const archived = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.resourceId)) continue;
    seen.add(row.resourceId);
    if (row.eventType === 'accounting.archived') archived.add(row.resourceId);
  }
  return archived;
}

/** Drop a draft journal. Posted books stay; use reverse or unpost for those. */
export async function discardDraftJournal(claims: SessionClaims, id: string) {
  if (!canManageAccounting(claims) && !canPostAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
    });
    if (!entry) fail('not_found');
    if (entry.status !== 'draft') fail('not_draft');
    await tx.delete(journalLines).where(eq(journalLines.journalEntryId, id));
    await tx.delete(journalEntries).where(eq(journalEntries.id, id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'journal_entry',
      resourceId: id,
      eventType: 'journal.discarded',
      fromStatus: 'draft',
      toStatus: 'deleted',
      note: entry.reference,
    });
    return { id, reference: entry.reference };
  });
}

/** Return a posted manual journal to draft when it has not been reversed and the period is open. */
export async function unpostJournal(claims: SessionClaims, id: string) {
  if (!canPostAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId)),
    });
    if (!entry) fail('not_found');
    if (entry.status !== 'posted') fail('not_posted');
    const settings = await readAccountingSettingsInTx(tx, orgId);
    if (
      settings.blockUnpostForLinked
        ? !canUnpostJournalSource(entry.sourceType)
        : isProtectedJournalSource(entry.sourceType)
    ) {
      fail('unpost_forbidden');
    }
    await assertPeriodOpen(tx, orgId, entry.occurredOn);
    const reversal = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.organizationId, orgId), eq(journalEntries.reversalOfId, id)),
    });
    if (reversal) fail('already_reversed');
    await tx
      .update(journalEntries)
      .set({
        status: 'draft',
        postedAt: null,
        postedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'journal_entry',
      resourceId: id,
      eventType: 'journal.unposted',
      fromStatus: 'posted',
      toStatus: 'draft',
    });
    return { id, status: 'draft' as const };
  });
}

export async function setAccountingArchived(
  claims: SessionClaims,
  resourceType: 'journal_entry' | 'invoice' | 'expense',
  id: string,
  archived: boolean,
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType,
      resourceId: id,
      eventType: archived ? 'accounting.archived' : 'accounting.restored',
      toStatus: archived ? 'archived' : 'active',
    });
    return { id, archived };
  });
}

export async function voidAccountingInvoice(claims: SessionClaims, id: string) {
  if (!canManageAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const row = await tx.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.organizationId, orgId)),
    });
    if (!row) fail('not_found');
    if (row.status === 'void') fail('already_void');
    if (row.paidMinor > 0n) fail('has_payments');
    await tx
      .update(invoices)
      .set({ status: 'void', updatedAt: new Date() })
      .where(eq(invoices.id, id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'invoice',
      resourceId: id,
      eventType: 'invoice.voided',
      fromStatus: row.status,
      toStatus: 'void',
    });
    return { id, status: 'void' as const };
  });
}

export async function cancelAccountingExpense(claims: SessionClaims, id: string) {
  if (!canManageAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const row = await tx.query.expenses.findFirst({
      where: and(eq(expenses.id, id), eq(expenses.organizationId, orgId)),
    });
    if (!row) fail('not_found');
    if (row.status === 'cancelled') fail('already_void');
    const linked = await tx.query.journalEntries.findFirst({
      where: and(
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.sourceType, 'expense'),
        eq(journalEntries.sourceId, id),
        inArray(journalEntries.status, ['posted', 'draft']),
      ),
    });
    if (linked?.status === 'posted') fail('must_reverse_first');
    if (linked?.status === 'draft') {
      await tx.delete(journalLines).where(eq(journalLines.journalEntryId, linked.id));
      await tx.delete(journalEntries).where(eq(journalEntries.id, linked.id));
    }
    await tx
      .update(expenses)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(expenses.id, id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'expense',
      resourceId: id,
      eventType: 'expense.cancelled',
      fromStatus: row.status,
      toStatus: 'cancelled',
    });
    return { id, status: 'cancelled' as const };
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
    const archived = await archivedIdSet(
      tx,
      orgId,
      'expense',
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      ...row,
      amountMinor: row.amountMinor.toString(),
      taxMinor: row.taxMinor.toString(),
      createdAt: row.createdAt.toISOString(),
      archived: archived.has(row.id),
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
    unitId?: string;
    partyId?: string;
    notes?: string;
    /** When true (default), post a balanced expense journal linked to property/unit/party. */
    postJournal?: boolean;
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
  const total =
    BigInt(input.amountMinor) +
    BigInt(input.taxMinor && /^\d+$/.test(input.taxMinor) ? input.taxMinor : '0');
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
        unitId: input.unitId,
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
    if (input.postJournal !== false && total > 0n) {
      const map = await ensureAccountCodeMap(tx, orgId);
      await postSourceDocumentInTx(tx, {
        organizationId: orgId,
        actorUserId: claims.sub,
        occurredOn: input.issuedOn,
        description: `مصروف ${row.reference}: ${input.description}`.slice(0, 500),
        sourceType: 'expense',
        sourceId: row.id,
        lines: postingExpensePaid(
          map,
          total.toString(),
          {
            currency,
            ...(input.propertyId ? { propertyId: input.propertyId } : {}),
            ...(input.unitId ? { unitId: input.unitId } : {}),
            ...(input.partyId ? { partyId: input.partyId } : {}),
          },
          'bank',
          expenseCodeFromCategory(input.category),
          input.category.slice(0, 500),
        ),
      });
    }
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

function settingsResourceId(orgId: string): string {
  return deterministicSourceId(`bhd-r:accounting-settings:${orgId}`);
}

async function readAccountingSettingsInTx(tx: GlTx, orgId: string): Promise<AccountingSettings> {
  const row = await tx
    .select({ metadata: workflowEvents.metadata })
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.organizationId, orgId),
        eq(workflowEvents.resourceType, SETTINGS_RESOURCE),
        eq(workflowEvents.resourceId, settingsResourceId(orgId)),
        eq(workflowEvents.eventType, 'settings.updated'),
      ),
    )
    .orderBy(desc(workflowEvents.occurredAt))
    .limit(1);
  if (!row[0]) return { ...DEFAULT_ACCOUNTING_SETTINGS };
  return decryptBankIbans(orgId, normalizeAccountingSettings(row[0].metadata));
}

export async function getAccountingSettings(claims: SessionClaims): Promise<AccountingSettings> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => readAccountingSettingsInTx(tx, orgId));
}

export async function setAccountingSettings(
  claims: SessionClaims,
  input: unknown,
): Promise<AccountingSettings> {
  if (!canManageAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const settings = normalizeAccountingSettings(input);
  const stored = encryptBankIbans(orgId, settings);
  return withinViewerTenant(claims, async (tx) => {
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: SETTINGS_RESOURCE,
      resourceId: settingsResourceId(orgId),
      eventType: 'settings.updated',
      toStatus: 'active',
      note: `VAT ${settings.vatEnabled ? settings.vatRatePercent : 0}% · ${settings.baseCurrency}`,
      metadata: stored,
    });
    return settings;
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
            'invoice',
            PERIOD_RESOURCE,
            SETTINGS_RESOURCE,
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

function addMinor(
  map: Map<string, { receivable: bigint; collected: bigint; expense: bigint; deposits: bigint }>,
  currency: string,
  field: 'receivable' | 'collected' | 'expense' | 'deposits',
  value: string | null | undefined,
) {
  if (!value || !/^-?\d+$/.test(value)) return;
  const row = map.get(currency) ?? {
    receivable: 0n,
    collected: 0n,
    expense: 0n,
    deposits: 0n,
  };
  row[field] += BigInt(value);
  map.set(currency, row);
}

export async function accountingDashboard(claims: SessionClaims) {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const [
      receivable,
      invoiceCollected,
      stayCollected,
      expenseTotal,
      depositHeld,
      bookingDeposits,
      draftJournals,
      overdue,
      accountCount,
      postedCount,
      recentStay,
    ] = await Promise.all([
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
          currency: stayPaymentIntents.currency,
          value: sql<string>`coalesce(sum(${stayPaymentIntents.amountMinor}), 0)::text`,
        })
        .from(stayPaymentIntents)
        .where(
          and(
            eq(stayPaymentIntents.organizationId, orgId),
            eq(stayPaymentIntents.status, 'succeeded'),
          ),
        )
        .groupBy(stayPaymentIntents.currency),
      tx
        .select({
          currency: expenses.currency,
          value: sql<string>`coalesce(sum(${expenses.amountMinor} + ${expenses.taxMinor}), 0)::text`,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.organizationId, orgId),
            inArray(expenses.status, ['approved', 'in_progress', 'completed', 'pending']),
          ),
        )
        .groupBy(expenses.currency),
      tx
        .select({
          currency: stayBookings.currency,
          value: sql<string>`coalesce(sum(${stayProfiles.depositMinor}), 0)::text`,
        })
        .from(stayBookings)
        .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
        .where(
          and(
            eq(stayBookings.organizationId, orgId),
            inArray(stayBookings.status, ['checked_in', 'checked_out', 'closed', 'confirmed']),
            sql`${stayProfiles.depositMinor} is not null and ${stayProfiles.depositMinor} > 0`,
          ),
        )
        .groupBy(stayBookings.currency),
      tx
        .select({
          currency: sql<string>`coalesce(${reservations.termsSnapshot}->>'currency', 'OMR')`,
          value: sql<string>`coalesce(sum((${reservations.termsSnapshot}->>'depositMinor')::bigint), 0)::text`,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, orgId),
            sql`${reservations.termsSnapshot}->>'depositPaidAt' is not null`,
            sql`${reservations.termsSnapshot}->>'depositMinor' ~ '^[1-9][0-9]*$'`,
          ),
        )
        .groupBy(sql`coalesce(${reservations.termsSnapshot}->>'currency', 'OMR')`),
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
        .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'posted'))),
      tx
        .select({
          id: stayPaymentIntents.id,
          amountMinor: stayPaymentIntents.amountMinor,
          currency: stayPaymentIntents.currency,
          referenceCode: stayBookings.referenceCode,
          receivedAt: stayPaymentIntents.updatedAt,
        })
        .from(stayPaymentIntents)
        .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
        .where(
          and(
            eq(stayPaymentIntents.organizationId, orgId),
            eq(stayPaymentIntents.status, 'succeeded'),
          ),
        )
        .orderBy(desc(stayPaymentIntents.updatedAt))
        .limit(8),
    ]);

    const byCurrency = new Map<
      string,
      { receivable: bigint; collected: bigint; expense: bigint; deposits: bigint }
    >();
    for (const row of receivable) addMinor(byCurrency, row.currency, 'receivable', row.value);
    for (const row of invoiceCollected) addMinor(byCurrency, row.currency, 'collected', row.value);
    for (const row of stayCollected) addMinor(byCurrency, row.currency, 'collected', row.value);
    for (const row of expenseTotal) addMinor(byCurrency, row.currency, 'expense', row.value);
    for (const row of depositHeld) addMinor(byCurrency, row.currency, 'deposits', row.value);
    for (const row of bookingDeposits) addMinor(byCurrency, row.currency, 'deposits', row.value);

    const currencies = [...byCurrency.keys()].sort();
    if (!currencies.length) currencies.push('OMR');
    const accounts = Number(accountCount[0]?.value ?? 0);
    const posted = Number(postedCount[0]?.value ?? 0);
    return {
      totalsByCurrency: currencies.map((currency) => {
        const row = byCurrency.get(currency) ?? {
          receivable: 0n,
          collected: 0n,
          expense: 0n,
          deposits: 0n,
        };
        return {
          currency,
          receivableMinor: row.receivable.toString(),
          collectedMinor: row.collected.toString(),
          expenseMinor: row.expense.toString(),
          depositsMinor: row.deposits.toString(),
        };
      }),
      draftJournals: Number(draftJournals[0]?.value ?? 0),
      overdueInvoices: Number(overdue[0]?.value ?? 0),
      accountCount: accounts,
      postedJournals: posted,
      needsSetup: accounts === 0 || posted === 0,
      recentActivity: recentStay.map((row) => ({
        id: row.id,
        kind: 'stay_payment' as const,
        label: row.referenceCode,
        amountMinor: row.amountMinor.toString(),
        currency: row.currency,
        at: row.receivedAt.toISOString(),
      })),
      capabilities: {
        manage: canManageAccounting(claims),
        post: canPostAccounting(claims),
      },
    };
  });
}

/**
 * Bootstrap CoA and post historical stay payments + paid booking deposits into the GL
 * (idempotent via sourceType+sourceId). Does not invent amounts — only existing ops rows.
 */
export async function syncOperationalGl(claims: SessionClaims) {
  if (!canManageAccounting(claims) && !canPostAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const actorUserId = claims.sub;
  return withinViewerTenant(claims, async (tx) => {
    const map = await ensureAccountCodeMap(tx, orgId);
    let stayPayments = 0;
    let reservationDeposits = 0;
    let stayDeposits = 0;

    const stays = await tx
      .select({
        id: stayPaymentIntents.id,
        amountMinor: stayPaymentIntents.amountMinor,
        currency: stayPaymentIntents.currency,
        updatedAt: stayPaymentIntents.updatedAt,
        bookingId: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        guestPartyId: stayBookings.guestPartyId,
      })
      .from(stayPaymentIntents)
      .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
      .where(
        and(
          eq(stayPaymentIntents.organizationId, orgId),
          eq(stayPaymentIntents.status, 'succeeded'),
          sql`${stayPaymentIntents.amountMinor} > 0`,
        ),
      )
      .limit(500);
    for (const row of stays) {
      const posted = await postSourceDocumentInTx(tx, {
        organizationId: orgId,
        actorUserId,
        occurredOn: row.updatedAt.toISOString().slice(0, 10),
        description: `تحصيل إقامة ${row.referenceCode}`.slice(0, 500),
        sourceType: 'stay_payment',
        sourceId: row.id,
        lines: postingRentReceipt(
          map,
          row.amountMinor.toString(),
          {
            currency: row.currency,
            propertyId: row.propertyId,
            unitId: row.unitId,
            ...(row.guestPartyId ? { partyId: row.guestPartyId } : {}),
          },
          'bank',
          row.referenceCode,
        ),
      });
      if (posted.created) stayPayments += 1;
    }

    const bookingRows = await tx
      .select({
        id: reservations.id,
        propertyId: units.propertyId,
        unitId: reservations.unitId,
        tenantPartyId: reservations.tenantPartyId,
        snapshot: reservations.termsSnapshot,
      })
      .from(reservations)
      .innerJoin(units, eq(units.id, reservations.unitId))
      .where(
        and(
          eq(reservations.organizationId, orgId),
          sql`${reservations.termsSnapshot}->>'depositPaidAt' is not null`,
          sql`${reservations.termsSnapshot}->>'depositMinor' ~ '^[1-9][0-9]*$'`,
        ),
      )
      .limit(300);
    for (const row of bookingRows) {
      const snap = row.snapshot as {
        depositMinor?: string;
        currency?: string;
        referenceCode?: string;
        depositPaidAt?: string;
      };
      const amount = snap.depositMinor!;
      const currency = snap.currency ?? 'OMR';
      const occurredOn = (snap.depositPaidAt ?? new Date().toISOString()).slice(0, 10);
      const posted = await postSourceDocumentInTx(tx, {
        organizationId: orgId,
        actorUserId,
        occurredOn: ISO_DATE.test(occurredOn) ? occurredOn : new Date().toISOString().slice(0, 10),
        description: `عربون حجز محتجز ${snap.referenceCode ?? row.id.slice(0, 8)}`.slice(0, 500),
        sourceType: 'reservation_deposit',
        sourceId: row.id,
        lines: postingDepositHeld(
          map,
          amount,
          {
            currency,
            propertyId: row.propertyId,
            unitId: row.unitId,
            partyId: row.tenantPartyId,
          },
          'bank',
          snap.referenceCode ?? row.id.slice(0, 8),
        ),
      });
      if (posted.created) reservationDeposits += 1;
    }

    const heldStays = await tx
      .select({
        id: stayBookings.id,
        currency: stayBookings.currency,
        referenceCode: stayBookings.referenceCode,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        guestPartyId: stayBookings.guestPartyId,
        depositMinor: stayProfiles.depositMinor,
        checkInOn: stayBookings.checkInOn,
      })
      .from(stayBookings)
      .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
      .where(
        and(
          eq(stayBookings.organizationId, orgId),
          inArray(stayBookings.status, ['checked_in', 'checked_out', 'closed']),
          sql`${stayProfiles.depositMinor} is not null and ${stayProfiles.depositMinor} > 0`,
        ),
      )
      .limit(300);
    for (const row of heldStays) {
      if (!row.depositMinor || row.depositMinor <= 0n) continue;
      const occurredOn = String(row.checkInOn).slice(0, 10);
      const posted = await postSourceDocumentInTx(tx, {
        organizationId: orgId,
        actorUserId,
        occurredOn,
        description: `تأمين إقامة محتجز ${row.referenceCode}`.slice(0, 500),
        sourceType: 'stay_deposit_held',
        sourceId: row.id,
        lines: postingDepositHeld(
          map,
          row.depositMinor.toString(),
          {
            currency: row.currency,
            propertyId: row.propertyId,
            unitId: row.unitId,
            ...(row.guestPartyId ? { partyId: row.guestPartyId } : {}),
          },
          'cash',
          row.referenceCode,
        ),
      });
      if (posted.created) stayDeposits += 1;
    }

    const accounts = await listAccountsInTx(tx, orgId);
    return {
      accountCount: accounts.length,
      stayPaymentsPosted: stayPayments,
      reservationDepositsPosted: reservationDeposits,
      stayDepositsPosted: stayDeposits,
    };
  });
}

/** Ensure the default chart exists and return code → account id for posting rules. */
export async function ensureAccountCodeMap(
  tx: GlTx,
  organizationId: string,
): Promise<AccountCodeMap> {
  await tx
    .insert(ledgerAccounts)
    .values(
      DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
        organizationId,
        ...account,
        system: true,
      })),
    )
    .onConflictDoNothing({
      target: [ledgerAccounts.organizationId, ledgerAccounts.code],
    });
  const rows = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.organizationId, organizationId));
  return new Map(rows.map((row) => [row.code, row.id]));
}

/**
 * Idempotent posted journal from an operational source (payment, refund, expense).
 * Unique (organization_id, source_type, source_id) prevents double posting (SRS §5).
 */
export async function postSourceDocumentInTx(
  tx: GlTx,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    occurredOn: string;
    description: string;
    sourceType: string;
    sourceId: string;
    lines: JournalLineInput[];
  },
): Promise<{ id: string; reference: string; status: string; created: boolean }> {
  if (!ISO_DATE.test(input.occurredOn)) fail('invalid_date');
  try {
    validateBalanced(input.lines);
  } catch (error) {
    if (error instanceof AccountingBalanceError) fail('unbalanced');
    throw error;
  }
  const existing = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.organizationId, input.organizationId),
      eq(journalEntries.sourceType, input.sourceType),
      eq(journalEntries.sourceId, input.sourceId),
    ),
    columns: { id: true, reference: true, status: true },
  });
  if (existing) {
    return {
      id: existing.id,
      reference: existing.reference,
      status: existing.status,
      created: false,
    };
  }
  await assertPeriodOpen(tx, input.organizationId, input.occurredOn);
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const accountRows = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.organizationId, input.organizationId),
        inArray(ledgerAccounts.id, accountIds),
      ),
    );
  if (accountRows.length !== accountIds.length) fail('account_missing');
  const entryRows = await tx
    .insert(journalEntries)
    .values({
      organizationId: input.organizationId,
      reference: await allocateJournalReference(tx, input.organizationId, input.occurredOn, 'JRN'),
      occurredOn: input.occurredOn,
      description: input.description.trim().slice(0, 500),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: 'posted',
      postedByUserId: input.actorUserId ?? undefined,
      postedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({
      id: journalEntries.id,
      reference: journalEntries.reference,
      status: journalEntries.status,
    });
  if (!entryRows[0]) {
    const again = await tx.query.journalEntries.findFirst({
      where: and(
        eq(journalEntries.organizationId, input.organizationId),
        eq(journalEntries.sourceType, input.sourceType),
        eq(journalEntries.sourceId, input.sourceId),
      ),
      columns: { id: true, reference: true, status: true },
    });
    if (!again) fail('not_found');
    return { id: again.id, reference: again.reference, status: again.status, created: false };
  }
  const entry = entryRows[0];
  await tx.insert(journalLines).values(
    input.lines.map((row) => {
      const currency = (row.currency || 'OMR') as CurrencyCode;
      return {
        organizationId: input.organizationId,
        journalEntryId: entry.id,
        accountId: row.accountId,
        partyId: row.partyId,
        propertyId: row.propertyId,
        unitId: row.unitId,
        debitMinor: BigInt(row.debitMinor),
        creditMinor: BigInt(row.creditMinor),
        currency,
        minorUnit: currencyMinorUnits[currency] ?? 3,
        memo: row.memo?.slice(0, 500),
      };
    }),
  );
  await tx.insert(workflowEvents).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    resourceType: 'journal_entry',
    resourceId: entry.id,
    eventType: 'journal.posted',
    toStatus: 'posted',
    note: `${input.sourceType}:${input.sourceId}`.slice(0, 500),
    metadata: { sourceType: input.sourceType, sourceId: input.sourceId },
  });
  const amountMinor = input.lines
    .reduce((sum, row) => sum + BigInt(row.debitMinor || '0'), 0n)
    .toString();
  await tx.insert(outboxEvents).values({
    organizationId: input.organizationId,
    topic: 'accounting.journal-posted',
    aggregateType: 'journal_entry',
    aggregateId: entry.id,
    payload: hisabyJournalPayload({
      journalId: entry.id,
      reference: entry.reference,
      occurredOn: input.occurredOn,
      description: input.description,
      amountMinor,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    }),
  });
  return { id: entry.id, reference: entry.reference, status: entry.status, created: true };
}

export type DimensionLedgerRow = {
  journalId: string;
  reference: string;
  occurredOn: string;
  description: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  memo: string | null;
  partyId: string | null;
  partyName: string | null;
  propertyId: string | null;
  propertyNameAr: string | null;
  unitId: string | null;
  unitCode: string | null;
};

/** Analytical ledger filtered by property, unit or party (SRS §6 general ledger). */
export async function loadDimensionLedger(
  claims: SessionClaims,
  input: {
    propertyId?: string;
    unitId?: string;
    partyId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  },
): Promise<{ rows: DimensionLedgerRow[]; totals: { debitMinor: string; creditMinor: string } }> {
  if (!canReadAccounting(claims)) fail('forbidden');
  if (!input.propertyId && !input.unitId && !input.partyId) fail('invalid_input');
  const orgId = claims.organizationId!;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  return withinViewerTenant(claims, async (tx) => {
    const filters = [
      eq(journalEntries.organizationId, orgId),
      eq(journalEntries.status, 'posted'),
      ...(input.propertyId ? [eq(journalLines.propertyId, input.propertyId)] : []),
      ...(input.unitId ? [eq(journalLines.unitId, input.unitId)] : []),
      ...(input.partyId ? [eq(journalLines.partyId, input.partyId)] : []),
      ...(input.fromDate && ISO_DATE.test(input.fromDate)
        ? [gte(journalEntries.occurredOn, input.fromDate)]
        : []),
      ...(input.toDate && ISO_DATE.test(input.toDate)
        ? [lte(journalEntries.occurredOn, input.toDate)]
        : []),
    ];
    const rows = await tx
      .select({
        journalId: journalEntries.id,
        reference: journalEntries.reference,
        occurredOn: journalEntries.occurredOn,
        description: journalEntries.description,
        accountCode: ledgerAccounts.code,
        accountNameAr: ledgerAccounts.nameAr,
        accountNameEn: ledgerAccounts.nameEn,
        debitMinor: journalLines.debitMinor,
        creditMinor: journalLines.creditMinor,
        currency: journalLines.currency,
        memo: journalLines.memo,
        partyId: journalLines.partyId,
        partyName: parties.displayName,
        propertyId: journalLines.propertyId,
        propertyNameAr: properties.nameAr,
        unitId: journalLines.unitId,
        unitCode: units.code,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .leftJoin(parties, eq(parties.id, journalLines.partyId))
      .leftJoin(properties, eq(properties.id, journalLines.propertyId))
      .leftJoin(units, eq(units.id, journalLines.unitId))
      .where(and(...filters))
      .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.createdAt))
      .limit(limit);
    let debit = 0n;
    let credit = 0n;
    const mapped = rows.map((row) => {
      debit += row.debitMinor;
      credit += row.creditMinor;
      return {
        journalId: row.journalId,
        reference: row.reference,
        occurredOn: row.occurredOn,
        description: row.description,
        accountCode: row.accountCode,
        accountNameAr: row.accountNameAr,
        accountNameEn: row.accountNameEn,
        debitMinor: row.debitMinor.toString(),
        creditMinor: row.creditMinor.toString(),
        currency: row.currency,
        memo: row.memo,
        partyId: row.partyId,
        partyName: row.partyName,
        propertyId: row.propertyId,
        propertyNameAr: row.propertyNameAr,
        unitId: row.unitId,
        unitCode: row.unitCode,
      };
    });
    return {
      rows: mapped,
      totals: { debitMinor: debit.toString(), creditMinor: credit.toString() },
    };
  });
}
