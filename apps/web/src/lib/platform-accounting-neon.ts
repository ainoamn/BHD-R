import 'server-only';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { elevatedTx, isoOf, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { requireScope } from '@/lib/site-admin-neon';
import {
  DEFAULT_PLANS,
  PLATFORM_LEDGER_KINDS,
  parsePlan,
  type PlatformAccountingView,
  type PlatformLedgerEntry,
  type PlatformLedgerKind,
  type PlanDefinition,
} from '@/lib/site-admin-shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(code: string): never {
  throw new Error(code);
}

function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isKind(value: unknown): value is PlatformLedgerKind {
  return typeof value === 'string' && (PLATFORM_LEDGER_KINDS as readonly string[]).includes(value);
}

async function ledgerReady(tx: ElevatedTx): Promise<boolean> {
  const [row] = rowsOf<{ ok: boolean }>(
    await tx.execute(sql`select to_regclass('public.platform_ledger_entries') is not null as ok`),
  );
  return Boolean(row?.ok);
}

function readCatalog(value: unknown): PlanDefinition[] {
  const list = (value as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list)) return DEFAULT_PLANS;
  const plans = list.map(parsePlan).filter((plan): plan is PlanDefinition => plan !== null);
  return plans.some((plan) => plan.key === 'starter') ? plans : DEFAULT_PLANS;
}

function omrToMinor(amount: number): number {
  return Math.round(amount * 1000);
}

/** Full accounting desk: marketing pulse, per-org money, site ledger. */
export function loadPlatformAccounting(claims: SessionClaims): Promise<PlatformAccountingView> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'accounting');
    const ready = await ledgerReady(tx);

    const [orgCount] = rowsOf<{ n: string }>(
      await tx.execute(sql`select count(*)::text as n from organizations`),
    );
    const [userCount] = rowsOf<{ n: string }>(
      await tx.execute(sql`select count(*)::text as n from users`),
    );
    const [propCount] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from properties where status::text <> 'archived'`,
      ),
    );
    const [unitCount] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from units where status::text <> 'archived'`,
      ),
    );

    const rentByOrg = rowsOf<{ organization_id: string; amount: string }>(
      await tx.execute(sql`
        select organization_id::text, coalesce(sum(amount_minor - refunded_minor), 0)::text as amount
        from payments
        where status = 'succeeded'
        group by organization_id
      `),
    );
    const stayByOrg = rowsOf<{ organization_id: string; amount: string }>(
      await tx.execute(sql`
        select organization_id::text, coalesce(sum(amount_minor), 0)::text as amount
        from stay_payment_intents
        where status = 'succeeded'
        group by organization_id
      `),
    );
    const expenseByOrg = rowsOf<{ organization_id: string; amount: string }>(
      await tx.execute(sql`
        select organization_id::text,
          coalesce(sum(amount_minor + tax_minor), 0)::text as amount
        from expenses
        where paid_at is not null or status::text in ('approved', 'completed')
        group by organization_id
      `),
    );

    const rentMap = new Map(rentByOrg.map((row) => [row.organization_id, num(row.amount)]));
    const stayMap = new Map(stayByOrg.map((row) => [row.organization_id, num(row.amount)]));
    const expenseMap = new Map(expenseByOrg.map((row) => [row.organization_id, num(row.amount)]));

    const orgs = rowsOf<{
      id: string;
      name_ar: string;
      name_en: string | null;
      plan_key: string;
      properties: number;
      units: number;
      members: number;
    }>(
      await tx.execute(sql`
        select o.id::text, o.display_name_ar as name_ar, o.display_name_en as name_en, o.plan_key,
          (select count(*)::int from properties p
            where p.organization_id = o.id and p.status::text <> 'archived') as properties,
          (select count(*)::int from units u
            where u.organization_id = o.id and u.status::text <> 'archived') as units,
          (select count(*)::int from memberships m
            where m.organization_id = o.id and m.status = 'active') as members
        from organizations o
        order by o.display_name_ar
        limit 2000
      `),
    );

    const accounts = orgs.map((org) => {
      const rentIncomeMinor = rentMap.get(org.id) ?? 0;
      const stayIncomeMinor = stayMap.get(org.id) ?? 0;
      return {
        organizationId: org.id,
        nameAr: org.name_ar,
        nameEn: org.name_en,
        planKey: org.plan_key,
        rentIncomeMinor,
        stayIncomeMinor,
        incomeMinor: rentIncomeMinor + stayIncomeMinor,
        expenseMinor: expenseMap.get(org.id) ?? 0,
        properties: Number(org.properties),
        units: Number(org.units),
        members: Number(org.members),
      };
    });

    accounts.sort((a, b) => b.incomeMinor - a.incomeMinor || a.nameAr.localeCompare(b.nameAr, 'ar'));

    const clientIncomeMinor = accounts.reduce((sum, row) => sum + row.incomeMinor, 0);
    const clientExpenseMinor = accounts.reduce((sum, row) => sum + row.expenseMinor, 0);

    let siteIncomeMinor = 0;
    let siteExpenseMinor = 0;
    let ledger: PlatformLedgerEntry[] = [];

    if (ready) {
      const rows = rowsOf<{
        id: string;
        occurred_on: string;
        kind: string;
        category: string;
        description: string;
        amount_minor: string;
        currency: string;
        organization_id: string | null;
        org_name: string | null;
        reference: string | null;
        status: string;
        created_at: Date | string | null;
      }>(
        await tx.execute(sql`
          select e.id::text, e.occurred_on::text, e.kind, e.category, e.description,
            e.amount_minor::text, e.currency, e.organization_id::text,
            o.display_name_ar as org_name, e.reference, e.status, e.created_at
          from platform_ledger_entries e
          left join organizations o on o.id = e.organization_id
          order by e.occurred_on desc, e.created_at desc
          limit 300
        `),
      );
      ledger = rows
        .filter((row) => isKind(row.kind))
        .map((row) => ({
          id: row.id,
          occurredOn: row.occurred_on,
          kind: row.kind as PlatformLedgerKind,
          category: row.category,
          description: row.description,
          amountMinor: num(row.amount_minor),
          currency: row.currency,
          organizationId: row.organization_id,
          organizationNameAr: row.org_name,
          reference: row.reference,
          status: (row.status === 'draft' || row.status === 'void' ? row.status : 'posted') as
            | 'draft'
            | 'posted'
            | 'void',
          createdAt: isoOf(row.created_at),
        }));

      for (const row of ledger) {
        if (row.status !== 'posted') continue;
        if (row.kind === 'expense') siteExpenseMinor += row.amountMinor;
        else if (row.kind === 'subscription_in' || row.kind === 'other_in')
          siteIncomeMinor += row.amountMinor;
      }
    }

    const [planRow] = rowsOf<{ value: unknown }>(
      await tx.execute(sql`select value from platform_settings where key = 'plan_catalog' limit 1`),
    );
    const catalog = readCatalog(planRow?.value);
    const planByKey = new Map(catalog.map((plan) => [plan.key, plan]));
    let estimatedSubscriptionMonthlyMinor = 0;
    for (const org of orgs) {
      const plan = planByKey.get(org.plan_key) ?? planByKey.get('starter');
      if (!plan) continue;
      const priceMinor = omrToMinor(Number(plan.price || 0));
      estimatedSubscriptionMonthlyMinor +=
        plan.period === 'year' ? Math.round(priceMinor / 12) : priceMinor;
    }

    return {
      generatedAt: new Date().toISOString(),
      currency: 'OMR',
      pulse: {
        clientIncomeMinor,
        clientExpenseMinor,
        siteIncomeMinor,
        siteExpenseMinor,
        estimatedSubscriptionMonthlyMinor,
        organizations: Number(orgCount?.n ?? 0),
        users: Number(userCount?.n ?? 0),
        properties: Number(propCount?.n ?? 0),
        units: Number(unitCount?.n ?? 0),
      },
      accounts,
      ledger,
      ledgerReady: ready,
    };
  }, 20_000);
}

export function createPlatformLedgerEntry(
  claims: SessionClaims,
  input: {
    kind: string;
    category: string;
    description: string;
    amountOmr: number;
    occurredOn: string;
    organizationId?: string | null;
    reference?: string | null;
  },
): Promise<PlatformLedgerEntry> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'accounting');
    if (!(await ledgerReady(tx))) fail('accounting_unavailable');
    if (!isKind(input.kind)) fail('ledger_invalid');
    const category = input.category.trim().slice(0, 80);
    const description = input.description.trim().slice(0, 500);
    const occurredOn = input.occurredOn.trim();
    const amountMinor = omrToMinor(Number(input.amountOmr));
    const organizationId = input.organizationId?.trim() || null;
    const reference = input.reference?.trim().slice(0, 120) || null;
    if (
      !category ||
      !description ||
      !DATE.test(occurredOn) ||
      !Number.isFinite(amountMinor) ||
      amountMinor <= 0 ||
      (organizationId && !UUID.test(organizationId))
    ) {
      fail('ledger_invalid');
    }

    const [row] = rowsOf<{
      id: string;
      occurred_on: string;
      kind: string;
      category: string;
      description: string;
      amount_minor: string;
      currency: string;
      organization_id: string | null;
      reference: string | null;
      status: string;
      created_at: Date | string | null;
    }>(
      await tx.execute(sql`
        insert into platform_ledger_entries (
          occurred_on, kind, category, description, amount_minor, currency, minor_unit,
          organization_id, reference, status, created_by_user_id
        ) values (
          ${occurredOn}::date, ${input.kind}, ${category}, ${description}, ${amountMinor},
          'OMR', 3,
          ${organizationId ? sql`${organizationId}::uuid` : sql`null`},
          ${reference}, 'posted', ${claims.sub}::uuid
        )
        returning id::text, occurred_on::text, kind, category, description, amount_minor::text,
          currency, organization_id::text, reference, status, created_at
      `),
    );
    if (!row || !isKind(row.kind)) fail('ledger_invalid');

    let organizationNameAr: string | null = null;
    if (row.organization_id) {
      const [org] = rowsOf<{ name: string }>(
        await tx.execute(
          sql`select display_name_ar as name from organizations where id = ${row.organization_id}::uuid`,
        ),
      );
      organizationNameAr = org?.name ?? null;
    }

    return {
      id: row.id,
      occurredOn: row.occurred_on,
      kind: row.kind,
      category: row.category,
      description: row.description,
      amountMinor: num(row.amount_minor),
      currency: row.currency,
      organizationId: row.organization_id,
      organizationNameAr,
      reference: row.reference,
      status: 'posted',
      createdAt: isoOf(row.created_at),
    };
  });
}

export function voidPlatformLedgerEntry(
  claims: SessionClaims,
  entryId: string,
): Promise<{ id: string; status: 'void' }> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'accounting');
    if (!(await ledgerReady(tx))) fail('accounting_unavailable');
    if (!UUID.test(entryId)) fail('ledger_not_found');
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        update platform_ledger_entries
        set status = 'void', updated_at = now()
        where id = ${entryId}::uuid and status <> 'void'
        returning id::text
      `),
    );
    if (!row) fail('ledger_not_found');
    return { id: row.id, status: 'void' };
  });
}
