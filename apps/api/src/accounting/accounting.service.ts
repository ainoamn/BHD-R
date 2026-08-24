import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  approvalRequests,
  expenses,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  outboxEvents,
  payments,
  workflowEvents,
} from '@bhd-r/db';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type ExpenseStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'rejected'
  | 'cancelled';

const expenseTransitions: Readonly<Record<ExpenseStatus, readonly ExpenseStatus[]>> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: [],
  rejected: ['pending', 'cancelled'],
  cancelled: [],
};

function reference(prefix: string): string {
  const now = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `${prefix}-${now}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function assertExpenseTransition(current: ExpenseStatus, next: ExpenseStatus) {
  if (current === next) return;
  if (!expenseTransitions[current].includes(next)) {
    throw new ConflictException(`Invalid expense transition: ${current} -> ${next}`);
  }
}

interface JournalLineInput {
  accountId: string;
  partyId?: string | undefined;
  propertyId?: string | undefined;
  unitId?: string | undefined;
  debitMinor: string;
  creditMinor: string;
  currency: CurrencyCode;
  memo?: string | undefined;
}

export function validateBalanced(lines: readonly JournalLineInput[]) {
  if (lines.length < 2) throw new ConflictException('A journal requires at least two lines');
  const balances = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);
    if ((debit > 0n && credit > 0n) || (debit === 0n && credit === 0n)) {
      throw new ConflictException('Each journal line must have either a debit or a credit');
    }
    const current = balances.get(line.currency) ?? { debit: 0n, credit: 0n };
    current.debit += debit;
    current.credit += credit;
    balances.set(line.currency, current);
  }
  for (const [currency, balance] of balances) {
    if (balance.debit !== balance.credit) {
      throw new ConflictException(`Journal is not balanced for ${currency}`);
    }
  }
}

async function logWorkflow(
  transaction: DatabaseTransaction,
  claims: SessionClaims,
  input: {
    resourceType: string;
    resourceId: string;
    eventType: string;
    fromStatus?: string | undefined;
    toStatus?: string | undefined;
    note?: string | undefined;
  },
) {
  await transaction.insert(workflowEvents).values({
    organizationId: claims.organizationId!,
    actorUserId: claims.sub,
    ...input,
  });
}

async function allocateJournalReference(
  transaction: DatabaseTransaction,
  organizationId: string,
  occurredOn: string,
  kind: 'JRN' | 'REV',
): Promise<string> {
  const year = Number(occurredOn.slice(0, 4));
  const sequence = await transaction.execute(sql<{ allocated: bigint }>`
    insert into journal_sequences (organization_id, year, kind, next_value)
    values (${organizationId}, ${year}, ${kind}, 2)
    on conflict (organization_id, year, kind)
    do update set next_value = journal_sequences.next_value + 1
    returning next_value - 1 as allocated
  `);
  return `${kind}-${year}-${BigInt(String(sequence[0]!.allocated)).toString().padStart(6, '0')}`;
}

@Injectable()
export class AccountingService {
  constructor(private readonly database: DatabaseService) {}

  dashboard(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [receivable, collected, expenseTotal, draftJournals, overdue] = await Promise.all([
        transaction
          .select({
            currency: invoices.currency,
            value: sql<string>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)`,
          })
          .from(invoices)
          .where(inArray(invoices.status, ['issued', 'partially_paid', 'overdue']))
          .groupBy(invoices.currency),
        transaction
          .select({
            currency: payments.currency,
            value: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)`,
          })
          .from(payments)
          .where(inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']))
          .groupBy(payments.currency),
        transaction
          .select({
            currency: expenses.currency,
            value: sql<string>`coalesce(sum(${expenses.amountMinor} + ${expenses.taxMinor}), 0)`,
          })
          .from(expenses)
          .where(inArray(expenses.status, ['approved', 'in_progress', 'completed']))
          .groupBy(expenses.currency),
        transaction
          .select({ value: count() })
          .from(journalEntries)
          .where(eq(journalEntries.status, 'draft')),
        transaction.select({ value: count() }).from(invoices).where(eq(invoices.status, 'overdue')),
      ]);
      const currencies = new Set([
        ...receivable.map((row) => row.currency),
        ...collected.map((row) => row.currency),
        ...expenseTotal.map((row) => row.currency),
      ]);
      return {
        totalsByCurrency: [...currencies].sort().map((currency) => ({
          currency,
          receivableMinor: receivable.find((row) => row.currency === currency)?.value ?? '0',
          collectedMinor: collected.find((row) => row.currency === currency)?.value ?? '0',
          expenseMinor: expenseTotal.find((row) => row.currency === currency)?.value ?? '0',
        })),
        draftJournals: draftJournals[0]?.value ?? 0,
        overdueInvoices: overdue[0]?.value ?? 0,
      };
    });
  }

  bootstrapChart(claims: SessionClaims) {
    const defaults: Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      type: AccountType;
    }> = [
      { code: '1000', nameAr: 'النقد والبنوك', nameEn: 'Cash and banks', type: 'asset' },
      { code: '1100', nameAr: 'ذمم المستأجرين', nameEn: 'Tenant receivables', type: 'asset' },
      { code: '1200', nameAr: 'دفعات مقدمة', nameEn: 'Prepayments', type: 'asset' },
      {
        code: '1300',
        nameAr: 'ضريبة مدخلات قابلة للاسترداد',
        nameEn: 'Recoverable input VAT',
        type: 'asset',
      },
      { code: '2100', nameAr: 'تأمينات المستأجرين', nameEn: 'Tenant deposits', type: 'liability' },
      { code: '2200', nameAr: 'ضريبة القيمة المضافة', nameEn: 'VAT payable', type: 'liability' },
      { code: '3000', nameAr: 'حقوق الملاك', nameEn: 'Owners equity', type: 'equity' },
      { code: '4000', nameAr: 'إيرادات الإيجار', nameEn: 'Rental income', type: 'revenue' },
      { code: '4100', nameAr: 'عمولات البيع', nameEn: 'Sales commission', type: 'revenue' },
      { code: '4200', nameAr: 'إيرادات الخدمات', nameEn: 'Service income', type: 'revenue' },
      { code: '5000', nameAr: 'مصروفات الصيانة', nameEn: 'Maintenance expense', type: 'expense' },
      { code: '5100', nameAr: 'مصروفات قانونية', nameEn: 'Legal expense', type: 'expense' },
      { code: '5200', nameAr: 'مصروفات تشغيلية', nameEn: 'Operating expense', type: 'expense' },
    ];
    return this.database.withinTenant(claims, async (transaction) => {
      await transaction
        .insert(ledgerAccounts)
        .values(
          defaults.map((account) => ({
            organizationId: claims.organizationId!,
            ...account,
            system: true,
          })),
        )
        .onConflictDoNothing({
          target: [ledgerAccounts.organizationId, ledgerAccounts.code],
        });
      return transaction
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.organizationId, claims.organizationId!))
        .orderBy(asc(ledgerAccounts.code));
    });
  }

  listAccounts(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.organizationId, claims.organizationId!))
        .orderBy(asc(ledgerAccounts.code)),
    );
  }

  createAccount(
    claims: SessionClaims,
    input: {
      parentId?: string | undefined;
      code: string;
      nameAr: string;
      nameEn: string;
      type: AccountType;
      currency?: CurrencyCode | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(ledgerAccounts)
        .values({ organizationId: claims.organizationId!, ...input })
        .returning();
      return rows[0]!;
    });
  }

  listJournals(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select({
          id: journalEntries.id,
          reference: journalEntries.reference,
          occurredOn: journalEntries.occurredOn,
          description: journalEntries.description,
          status: journalEntries.status,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          postedAt: journalEntries.postedAt,
          createdAt: journalEntries.createdAt,
        })
        .from(journalEntries)
        .where(eq(journalEntries.organizationId, claims.organizationId!))
        .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.createdAt));
      const totals = rows.length
        ? await transaction
            .select({
              journalEntryId: journalLines.journalEntryId,
              currency: journalLines.currency,
              debitMinor: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)`,
              creditMinor: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)`,
            })
            .from(journalLines)
            .where(
              inArray(
                journalLines.journalEntryId,
                rows.map((row) => row.id),
              ),
            )
            .groupBy(journalLines.journalEntryId, journalLines.currency)
        : [];
      return rows.map((row) => {
        const amounts = totals.filter((total) => total.journalEntryId === row.id);
        return {
          ...row,
          amounts,
          ...(amounts.length === 1
            ? {
                currency: amounts[0]!.currency,
                debitMinor: amounts[0]!.debitMinor,
                creditMinor: amounts[0]!.creditMinor,
              }
            : { currency: null, debitMinor: null, creditMinor: null }),
        };
      });
    });
  }

  getJournal(claims: SessionClaims, id: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const entry = await transaction.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.id, id),
          eq(journalEntries.organizationId, claims.organizationId!),
        ),
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      const lines = await transaction
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, id))
        .orderBy(asc(journalLines.createdAt));
      return {
        ...entry,
        lines: lines.map((line) => ({
          ...line,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString(),
        })),
      };
    });
  }

  createJournal(
    claims: SessionClaims,
    input: {
      occurredOn: string;
      description: string;
      sourceType?: string | undefined;
      sourceId?: string | undefined;
      lines: JournalLineInput[];
    },
  ) {
    validateBalanced(input.lines);
    return this.database.withinTenant(claims, async (transaction) => {
      const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
      const accountRows = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.organizationId, claims.organizationId!),
            inArray(ledgerAccounts.id, accountIds),
          ),
        );
      if (accountRows.length !== accountIds.length) {
        throw new NotFoundException('One or more ledger accounts were not found');
      }
      const entryRows = await transaction
        .insert(journalEntries)
        .values({
          organizationId: claims.organizationId!,
          reference: await allocateJournalReference(
            transaction,
            claims.organizationId!,
            input.occurredOn,
            'JRN',
          ),
          occurredOn: input.occurredOn,
          description: input.description,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        })
        .returning();
      const entry = entryRows[0]!;
      await transaction.insert(journalLines).values(
        input.lines.map((line) => ({
          organizationId: claims.organizationId!,
          journalEntryId: entry.id,
          accountId: line.accountId,
          partyId: line.partyId,
          propertyId: line.propertyId,
          unitId: line.unitId,
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          currency: line.currency,
          minorUnit: currencyMinorUnits[line.currency],
          memo: line.memo,
        })),
      );
      await logWorkflow(transaction, claims, {
        resourceType: 'journal_entry',
        resourceId: entry.id,
        eventType: 'journal.created',
        toStatus: 'draft',
      });
      return { ...entry, lines: input.lines };
    });
  }

  postJournal(claims: SessionClaims, id: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const entry = await transaction.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.id, id),
          eq(journalEntries.organizationId, claims.organizationId!),
        ),
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'draft')
        throw new ConflictException('Only draft journals can be posted');
      const lines = await transaction
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, id));
      validateBalanced(
        lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId ?? undefined,
          propertyId: line.propertyId ?? undefined,
          unitId: line.unitId ?? undefined,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString(),
          currency: line.currency as CurrencyCode,
          memo: line.memo ?? undefined,
        })),
      );
      const rows = await transaction
        .update(journalEntries)
        .set({
          status: 'posted',
          postedByUserId: claims.sub,
          postedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(journalEntries.id, id))
        .returning();
      await logWorkflow(transaction, claims, {
        resourceType: 'journal_entry',
        resourceId: id,
        eventType: 'journal.posted',
        fromStatus: 'draft',
        toStatus: 'posted',
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'accounting.journal-posted',
        aggregateType: 'journal_entry',
        aggregateId: id,
        payload: { reference: entry.reference },
      });
      return rows[0]!;
    });
  }

  reverseJournal(claims: SessionClaims, id: string, occurredOn: string, note?: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const entry = await transaction.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.id, id),
          eq(journalEntries.organizationId, claims.organizationId!),
        ),
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'posted')
        throw new ConflictException('Only posted journals can be reversed');
      const existingReversal = await transaction.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.organizationId, claims.organizationId!),
          eq(journalEntries.reversalOfId, id),
        ),
      });
      if (existingReversal) throw new ConflictException('Journal already reversed');
      const sourceLines = await transaction
        .select()
        .from(journalLines)
        .where(eq(journalLines.journalEntryId, id));
      const reversalRows = await transaction
        .insert(journalEntries)
        .values({
          organizationId: claims.organizationId!,
          reference: await allocateJournalReference(
            transaction,
            claims.organizationId!,
            occurredOn,
            'REV',
          ),
          occurredOn,
          description: note ?? `Reversal of ${entry.reference}`,
          status: 'posted',
          sourceType: 'journal_reversal',
          sourceId: id,
          reversalOfId: id,
          postedByUserId: claims.sub,
          postedAt: new Date(),
        })
        .returning();
      const reversal = reversalRows[0]!;
      await transaction.insert(journalLines).values(
        sourceLines.map((line) => ({
          organizationId: claims.organizationId!,
          journalEntryId: reversal.id,
          accountId: line.accountId,
          partyId: line.partyId,
          propertyId: line.propertyId,
          unitId: line.unitId,
          debitMinor: line.creditMinor,
          creditMinor: line.debitMinor,
          currency: line.currency,
          minorUnit: line.minorUnit,
          memo: `Reversal: ${line.memo ?? entry.reference}`,
        })),
      );
      await transaction
        .update(journalEntries)
        .set({ status: 'reversed', updatedAt: new Date() })
        .where(eq(journalEntries.id, id));
      await logWorkflow(transaction, claims, {
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

  trialBalance(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select({
          accountId: ledgerAccounts.id,
          code: ledgerAccounts.code,
          nameAr: ledgerAccounts.nameAr,
          nameEn: ledgerAccounts.nameEn,
          type: ledgerAccounts.type,
          currency: journalLines.currency,
          debitMinor: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)`,
          creditMinor: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)`,
          balanceMinor: sql<string>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)`,
        })
        .from(ledgerAccounts)
        .leftJoin(
          journalLines,
          and(
            eq(journalLines.accountId, ledgerAccounts.id),
            sql`exists (select 1 from journal_entries je where je.id = ${journalLines.journalEntryId} and je.status = 'posted')`,
          ),
        )
        .where(eq(ledgerAccounts.organizationId, claims.organizationId!))
        .groupBy(
          ledgerAccounts.id,
          ledgerAccounts.code,
          ledgerAccounts.nameAr,
          ledgerAccounts.nameEn,
          ledgerAccounts.type,
          journalLines.currency,
        )
        .orderBy(asc(ledgerAccounts.code)),
    );
  }

  listExpenses(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(expenses)
        .where(eq(expenses.organizationId, claims.organizationId!))
        .orderBy(desc(expenses.issuedOn), desc(expenses.createdAt));
      return rows.map((row) => ({
        ...row,
        amountMinor: row.amountMinor.toString(),
        taxMinor: row.taxMinor.toString(),
      }));
    });
  }

  createExpense(
    claims: SessionClaims,
    input: {
      propertyId?: string | undefined;
      unitId?: string | undefined;
      vendorId?: string | undefined;
      workOrderId?: string | undefined;
      category: string;
      description: string;
      amountMinor: string;
      taxMinor?: string | undefined;
      currency: CurrencyCode;
      issuedOn: string;
      dueOn?: string | undefined;
      notes?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(expenses)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('EXP'),
          ...input,
          amountMinor: BigInt(input.amountMinor),
          taxMinor: BigInt(input.taxMinor ?? '0'),
          minorUnit: currencyMinorUnits[input.currency],
        })
        .returning();
      const row = rows[0]!;
      await logWorkflow(transaction, claims, {
        resourceType: 'expense',
        resourceId: row.id,
        eventType: 'expense.created',
        toStatus: row.status,
      });
      await transaction.insert(approvalRequests).values({
        organizationId: claims.organizationId!,
        reference: `APR-${row.reference}`,
        type: 'expense_approval',
        subject: `Expense ${row.reference}: ${row.description}`.slice(0, 240),
        resourceType: 'expense',
        resourceId: row.id,
        requestedByUserId: claims.sub,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'approval.requested',
        aggregateType: 'expense',
        aggregateId: row.id,
        payload: { reference: row.reference },
      });
      return {
        ...row,
        amountMinor: row.amountMinor.toString(),
        taxMinor: row.taxMinor.toString(),
      };
    });
  }

  updateExpense(
    claims: SessionClaims,
    id: string,
    input: { status: ExpenseStatus; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.expenses.findFirst({
        where: and(eq(expenses.id, id), eq(expenses.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Expense not found');
      if (
        current.status === 'pending' &&
        (input.status === 'approved' || input.status === 'rejected')
      ) {
        throw new ConflictException('Use the approval center to decide this expense');
      }
      assertExpenseTransition(current.status, input.status);
      const rows = await transaction
        .update(expenses)
        .set({
          status: input.status,
          paidAt: input.status === 'completed' ? new Date() : current.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(expenses.id, id))
        .returning();
      await logWorkflow(transaction, claims, {
        resourceType: 'expense',
        resourceId: id,
        eventType: 'expense.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      const row = rows[0]!;
      if (input.status === 'completed' && current.status !== 'completed') {
        await this.postExpenseJournal(transaction, claims, row);
      }
      return {
        ...row,
        amountMinor: row.amountMinor.toString(),
        taxMinor: row.taxMinor.toString(),
      };
    });
  }

  private async postExpenseJournal(
    transaction: DatabaseTransaction,
    claims: SessionClaims,
    expense: typeof expenses.$inferSelect,
  ) {
    if (!(expense.currency in currencyMinorUnits)) {
      throw new ConflictException(`Unsupported expense currency: ${expense.currency}`);
    }
    const existing = await transaction.query.journalEntries.findFirst({
      where: and(
        eq(journalEntries.organizationId, claims.organizationId!),
        eq(journalEntries.sourceType, 'expense_payment'),
        eq(journalEntries.sourceId, expense.id),
      ),
    });
    if (existing) return existing;
    const expenseCode = expense.category.toLowerCase().includes('legal')
      ? '5100'
      : expense.category.toLowerCase().includes('maintenance')
        ? '5000'
        : '5200';
    const defaults = [
      { code: '1000', nameAr: 'النقد والبنوك', nameEn: 'Cash and banks', type: 'asset' as const },
      {
        code: '1300',
        nameAr: 'ضريبة مدخلات قابلة للاسترداد',
        nameEn: 'Recoverable input VAT',
        type: 'asset' as const,
      },
      {
        code: '5000',
        nameAr: 'مصروفات الصيانة',
        nameEn: 'Maintenance expense',
        type: 'expense' as const,
      },
      {
        code: '5100',
        nameAr: 'مصروفات قانونية',
        nameEn: 'Legal expense',
        type: 'expense' as const,
      },
      {
        code: '5200',
        nameAr: 'مصروفات تشغيلية',
        nameEn: 'Operating expense',
        type: 'expense' as const,
      },
    ];
    await transaction
      .insert(ledgerAccounts)
      .values(
        defaults.map((account) => ({
          organizationId: claims.organizationId!,
          ...account,
          system: true,
        })),
      )
      .onConflictDoNothing({ target: [ledgerAccounts.organizationId, ledgerAccounts.code] });
    const requiredCodes = ['1000', expenseCode, ...(expense.taxMinor > 0n ? ['1300'] : [])];
    const accountRows = await transaction
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, claims.organizationId!),
          inArray(ledgerAccounts.code, requiredCodes),
        ),
      );
    const accounts = new Map(accountRows.map((account) => [account.code, account.id]));
    if (accounts.size !== new Set(requiredCodes).size) {
      throw new ConflictException('Required system ledger accounts are unavailable');
    }
    const occurredOn = expense.paidAt
      ? expense.paidAt.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const entryRows = await transaction
      .insert(journalEntries)
      .values({
        organizationId: claims.organizationId!,
        reference: await allocateJournalReference(
          transaction,
          claims.organizationId!,
          occurredOn,
          'JRN',
        ),
        occurredOn,
        description: `Expense payment ${expense.reference}`,
        status: 'posted',
        sourceType: 'expense_payment',
        sourceId: expense.id,
        postedByUserId: claims.sub,
        postedAt: new Date(),
      })
      .returning();
    const entry = entryRows[0]!;
    const currency = expense.currency as CurrencyCode;
    const total = expense.amountMinor + expense.taxMinor;
    await transaction.insert(journalLines).values([
      {
        organizationId: claims.organizationId!,
        journalEntryId: entry.id,
        accountId: accounts.get(expenseCode)!,
        propertyId: expense.propertyId,
        unitId: expense.unitId,
        debitMinor: expense.amountMinor,
        creditMinor: 0n,
        currency,
        minorUnit: currencyMinorUnits[currency],
        memo: expense.description,
      },
      ...(expense.taxMinor > 0n
        ? [
            {
              organizationId: claims.organizationId!,
              journalEntryId: entry.id,
              accountId: accounts.get('1300')!,
              propertyId: expense.propertyId,
              unitId: expense.unitId,
              debitMinor: expense.taxMinor,
              creditMinor: 0n,
              currency,
              minorUnit: currencyMinorUnits[currency],
              memo: `Tax: ${expense.description}`,
            },
          ]
        : []),
      {
        organizationId: claims.organizationId!,
        journalEntryId: entry.id,
        accountId: accounts.get('1000')!,
        propertyId: expense.propertyId,
        unitId: expense.unitId,
        debitMinor: 0n,
        creditMinor: total,
        currency,
        minorUnit: currencyMinorUnits[currency],
        memo: expense.description,
      },
    ]);
    await transaction.insert(outboxEvents).values({
      organizationId: claims.organizationId!,
      topic: 'accounting.journal-posted',
      aggregateType: 'journal_entry',
      aggregateId: entry.id,
      payload: { reference: entry.reference, sourceType: 'expense_payment', sourceId: expense.id },
    });
    return entry;
  }
}
