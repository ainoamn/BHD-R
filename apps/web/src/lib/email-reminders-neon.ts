import 'server-only';
import { sql } from 'drizzle-orm';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { leaseStatementsInTx } from '@/lib/tenancy-neon';
import { muscatToday } from '@/lib/tenant-charges-neon';
import { arrearsLabel, type LeaseStatement, type LedgerLine } from '@/lib/tenant-ledger';

/** Days after the oldest unpaid due date on which a tenant hears about their arrears. */
const ARREARS_DAYS = [1, 3, 7, 14, 30, 60, 90];
const DUE_SOON_DAYS = 3;
const LEASE_NOTICE_DAYS = [60, 30];
/** Sunday in Muscat: the start of the working week. */
const DIGEST_WEEKDAY = 0;
const LEASES_MAX = 3000;
/** Leases per statement read: the statement query caps its cheque and invoice rows. */
const STATEMENT_CHUNK = 20;
const BATCH_MAX = 200;

export type ReminderRun = {
  arrears: number;
  dueSoon: number;
  leaseExpiry: number;
  digests: number;
  skipped: number;
  stoppedEarly: boolean;
};

type LeaseRow = {
  id: string;
  organization_id: string;
  contract_id: string | null;
  owner_party_id: string;
  tenant_party_id: string;
  property_id: string;
  starts_on: string;
  ends_on: string;
  currency: string;
  property: string;
  unit: string;
};

type OrgArrears = { leases: number; byCurrency: Map<string, bigint> };

function arDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso;
}

function amountOf(minor: string | bigint, currency: string): string {
  return formatMoney(String(minor), currency, 'ar-OM');
}

function arDays(count: number): string {
  if (count === 1) return 'يوم واحد';
  if (count === 2) return 'يومان';
  if (count >= 3 && count <= 10) return `${count} أيام`;
  return `${count} يوماً`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** An installment the tenant still has to pay themselves: not one a held cheque will cover. */
function payableLine(line: LedgerLine): boolean {
  if (line.outsideTotal || line.status === 'paid' || line.status === 'collecting') return false;
  return !(
    line.chequeStatus === 'pending' ||
    line.chequeStatus === 'accepted' ||
    line.chequeStatus === 'deposited'
  );
}

/** Reminder keys already queued recently, without the per-recipient suffix. */
async function recentReminderKeys(): Promise<Set<string>> {
  const rows = await elevatedTx(async (tx) =>
    rowsOf<{ key: string }>(
      await tx.execute(sql`select payload->>'dedupeKey' as key from outbox_events
        where topic = 'notification.delivery.requested'
          and occurred_at > now() - interval '3 days'
          and payload->>'dedupeKey' like 'reminder:%'`),
    ),
  );
  return new Set(rows.map((row) => row.key.slice(0, row.key.lastIndexOf(':'))));
}

async function runningLeases(today: string): Promise<LeaseRow[]> {
  return elevatedTx(async (tx) =>
    rowsOf<LeaseRow>(
      await tx.execute(sql`select l.id, l.organization_id, l.contract_id, l.owner_party_id,
          l.tenant_party_id, u.property_id, l.starts_on::text as starts_on,
          l.ends_on::text as ends_on, l.currency, p.name_ar as property, u.code as unit
        from leases l
        join units u on u.id = l.unit_id
        join properties p on p.id = u.property_id
        join organizations o on o.id = l.organization_id and o.status = 'active'
        where l.status in ('active', 'cancel_requested', 'clearance_pending')
          and l.starts_on <= ${today}::date
        order by l.organization_id
        limit ${LEASES_MAX}`),
    ),
  );
}

async function statementsOf(leases: LeaseRow[]): Promise<Map<string, LeaseStatement>> {
  const out = new Map<string, LeaseStatement>();
  const byOrg = new Map<string, string[]>();
  for (const lease of leases) {
    byOrg.set(lease.organization_id, [...(byOrg.get(lease.organization_id) ?? []), lease.id]);
  }
  for (const [orgId, ids] of byOrg) {
    for (let start = 0; start < ids.length; start += STATEMENT_CHUNK) {
      const chunk = ids.slice(start, start + STATEMENT_CHUNK);
      const rows = await elevatedTx((tx) => leaseStatementsInTx(tx, orgId, chunk));
      for (const [id, row] of rows) out.set(id, row.statement);
    }
  }
  return out;
}

type VacancyRow = {
  organization_id: string;
  org: string;
  vacant: number;
  vacant_names: string[] | null;
  unlisted: number;
};

/** Per organization: rentable units with no lease running today. */
async function vacancies(today: string): Promise<VacancyRow[]> {
  return elevatedTx(async (tx) =>
    rowsOf<VacancyRow>(
      await tx.execute(sql`with vacant as (
          select u.organization_id, p.name_ar || ' — ' || u.code as name,
            exists (select 1 from listings li where li.unit_id = u.id and li.enabled) as listed
          from units u join properties p on p.id = u.property_id
          where u.status = 'active' and p.status = 'active'
            and u.listing_purpose in ('rent', 'both')
            and not exists (select 1 from stay_profiles sp where sp.unit_id = u.id)
            and not exists (select 1 from leases l where l.unit_id = u.id
              and l.status in ('active', 'cancel_requested', 'clearance_pending')
              and l.starts_on <= ${today}::date and l.ends_on >= ${today}::date)
        )
        select o.id as organization_id, o.display_name_ar as org,
          count(v.*)::int as vacant,
          (array_agg(v.name order by v.name))[1:8] as vacant_names,
          count(v.*) filter (where not v.listed)::int as unlisted
        from organizations o join vacant v on v.organization_id = o.id
        where o.status = 'active'
        group by o.id, o.display_name_ar
        limit ${BATCH_MAX}`),
    ),
  );
}

async function organizationNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await elevatedTx(async (tx) =>
    rowsOf<{ id: string; name: string }>(
      await tx.execute(sql`select id, display_name_ar as name from organizations
        where id = any(${`{${ids.join(',')}}`}::uuid[])`),
    ),
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Daily reminders: rent installments and bills a few days before they fall due and on set days
 * after, leases nearing their end, and on Sundays a digest of vacancies and arrears for each
 * organization's managers. Each reminder carries a key, so a second run on the same day emails
 * nobody twice.
 */
export async function sendDailyReminders(
  deadline: number,
  options: { digest?: boolean } = {},
): Promise<ReminderRun> {
  const today = muscatToday();
  const sent = await recentReminderKeys();
  const run: ReminderRun = {
    arrears: 0,
    dueSoon: 0,
    leaseExpiry: 0,
    digests: 0,
    skipped: 0,
    stoppedEarly: false,
  };
  const fresh = (key: string) => {
    if (sent.has(key)) {
      run.skipped += 1;
      return false;
    }
    sent.add(key);
    return true;
  };
  const outOfTime = () => {
    if (Date.now() < deadline) return false;
    run.stoppedEarly = true;
    return true;
  };

  const leases = await runningLeases(today);
  const statements = await statementsOf(leases);
  const orgArrears = new Map<string, OrgArrears>();
  const soon = plusDays(today, DUE_SOON_DAYS);

  for (const lease of leases) {
    if (outOfTime()) return run;
    const statement = statements.get(lease.id);
    if (!statement) continue;
    const place = `${lease.property} — ${lease.unit}`;
    const tenantLink = appLink('/ar/tenant');
    const arrears = statement.arrears;
    const oldest = arrears.items[0];

    if (oldest) {
      const totals = orgArrears.get(lease.organization_id) ?? { leases: 0, byCurrency: new Map() };
      totals.leases += 1;
      totals.byCurrency.set(
        lease.currency,
        (totals.byCurrency.get(lease.currency) ?? 0n) + BigInt(arrears.totalMinor),
      );
      orgArrears.set(lease.organization_id, totals);

      const days = daysBetween(oldest.dueOn, today);
      const key = `reminder:arrears:${lease.id}:${oldest.key}:${days}`;
      if (ARREARS_DAYS.includes(days) && fresh(key)) {
        run.arrears += await notifyByEmail({
          orgId: lease.organization_id,
          aggregateType: 'lease',
          aggregateId: lease.id,
          dedupeKey: key,
          audience: { parties: [lease.tenant_party_id] },
          content: () => ({
            tone: 'arrears',
            subject: `⏰ تذكير ودّي: مستحقات متأخرة على ${place}`,
            title: 'لديك مستحقات تنتظر التسوية',
            intro: `مرّ ${arDays(days)} على أقدم مبلغ مستحق ولم يُسدَّد بعد. نعرف أن الأيام تمضي سريعاً، فإليك الملخص لتسوّيه بنقرة.`,
            details: [
              { label: 'العقار', value: place },
              { label: 'إجمالي المتأخرات', value: amountOf(arrears.totalMinor, lease.currency) },
              ...arrears.byCategory.slice(0, 4).map((row) => ({
                label: arrearsLabel(row.category, true),
                value: amountOf(row.amountMinor, lease.currency),
              })),
              { label: 'أقدم تاريخ استحقاق', value: arDate(oldest.dueOn) },
            ],
            cta: { label: 'عرض كشف الحساب', url: tenantLink },
            footnote: 'إن كنت سدّدت للتوّ فتجاهل هذه الرسالة، وشكراً لك 🙏',
          }),
        });
      }
    }

    for (const line of statement.lines) {
      if (line.dueOn !== soon || !payableLine(line)) continue;
      const key = `reminder:due:${lease.id}:${line.key}`;
      if (!fresh(key)) continue;
      const left = BigInt(line.amountMinor) - BigInt(line.paidMinor);
      run.dueSoon += await notifyByEmail({
        orgId: lease.organization_id,
        aggregateType: 'lease',
        aggregateId: lease.id,
        dedupeKey: key,
        audience: { parties: [lease.tenant_party_id] },
        content: () => ({
          tone: 'reminder',
          subject: `📅 دفعة ${place} تستحق بعد ${arDays(DUE_SOON_DAYS)}`,
          title: 'موعد السداد يقترب',
          intro: `تذكير سريع قبل أن يفاجئك التقويم: لديك دفعة تستحق يوم ${arDate(line.dueOn)}.`,
          details: [
            { label: 'العقار', value: place },
            {
              label: 'الدفعة',
              value:
                line.kind === 'invoice' && line.invoiceNumber
                  ? `فاتورة ${line.invoiceNumber}`
                  : line.index
                    ? `القسط رقم ${line.index}`
                    : 'دفعة مستحقة',
            },
            { label: 'المبلغ', value: amountOf(left, lease.currency) },
            { label: 'تاريخ الاستحقاق', value: arDate(line.dueOn) },
          ],
          cta: { label: 'عرض كشف الحساب', url: tenantLink },
        }),
      });
    }

    const remaining = daysBetween(today, lease.ends_on);
    if (!LEASE_NOTICE_DAYS.includes(remaining)) continue;
    const leaseKey = `reminder:lease:${lease.id}:${remaining}`;
    const details = [
      { label: 'العقار', value: place },
      { label: 'ينتهي العقد في', value: arDate(lease.ends_on) },
      { label: 'المتبقي', value: arDays(remaining) },
    ];
    if (fresh(`${leaseKey}:tenant`)) {
      run.leaseExpiry += await notifyByEmail({
        orgId: lease.organization_id,
        aggregateType: 'lease',
        aggregateId: lease.id,
        dedupeKey: `${leaseKey}:tenant`,
        audience: { parties: [lease.tenant_party_id] },
        content: () => ({
          tone: 'contract',
          subject: `📜 عقدك في ${lease.property} ينتهي بعد ${arDays(remaining)}`,
          title: 'عقدك يقترب من خط النهاية',
          intro:
            'هل تودّ البقاء؟ أخبر المالك مبكراً لنرتّب التجديد بهدوء، أو لنجهّز خطوات التسليم دون عجلة.',
          details,
          cta: {
            label: 'عرض العقد',
            url: appLink(
              lease.contract_id ? `/ar/tenant/contracts/${lease.contract_id}` : '/ar/tenant',
            ),
          },
        }),
      });
    }
    if (fresh(`${leaseKey}:owner`)) {
      run.leaseExpiry += await notifyByEmail({
        orgId: lease.organization_id,
        aggregateType: 'lease',
        aggregateId: lease.id,
        dedupeKey: `${leaseKey}:owner`,
        audience: {
          parties: [lease.owner_party_id],
          managersOf: { orgId: lease.organization_id, propertyId: lease.property_id },
        },
        content: () => ({
          tone: 'contract',
          subject: `📜 عقد ${place} ينتهي بعد ${arDays(remaining)}`,
          title: 'عقد على وشك الانتهاء',
          intro: 'وقت مناسب للتواصل مع المستأجر بشأن التجديد، أو لتجهيز الوحدة لمستأجر جديد.',
          details,
          cta: {
            label: 'فتح العقد',
            url: appLink(
              lease.contract_id ? `/ar/owner/contracts/${lease.contract_id}` : '/ar/owner',
            ),
          },
        }),
      });
    }
  }

  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday !== DIGEST_WEEKDAY && !options.digest) return run;
  const vacant = new Map((await vacancies(today)).map((row) => [row.organization_id, row]));
  const orgIds = [...new Set([...vacant.keys(), ...orgArrears.keys()])].slice(0, BATCH_MAX);
  const names = await organizationNames(orgIds.filter((id) => !vacant.has(id)));
  for (const orgId of orgIds) {
    if (outOfTime()) return run;
    const key = `reminder:digest:${orgId}:${today}`;
    if (!fresh(key)) continue;
    const vacancy = vacant.get(orgId);
    const owed = orgArrears.get(orgId);
    const orgName = vacancy?.org ?? names.get(orgId) ?? '';
    const vacantCount = vacancy?.vacant ?? 0;
    const overdue = owed
      ? [...owed.byCurrency].map(([currency, minor]) => amountOf(minor, currency)).join(' + ')
      : '';
    const lines = (vacancy?.vacant_names ?? []).map((name) => `🏠 ${name}`);
    if (vacantCount > lines.length && lines.length) {
      lines.push(`… و${vacantCount - lines.length} وحدة أخرى`);
    }
    run.digests += await notifyByEmail({
      orgId,
      aggregateType: 'organization',
      aggregateId: orgId,
      dedupeKey: key,
      audience: { managersOf: { orgId } },
      content: () => ({
        tone: vacantCount ? 'vacancy' : 'arrears',
        subject: `📊 ملخص الأسبوع لـ ${orgName} — الشواغر: ${vacantCount} · عقود متأخرة: ${owed?.leases ?? 0}`,
        title: 'ملخّصك الأسبوعي',
        intro: 'صباح الخير! جهّزنا لك ما يحتاج انتباهك هذا الأسبوع قبل أن تبرد قهوتك ☕',
        details: [
          { label: 'وحدات شاغرة', value: String(vacantCount) },
          ...(vacancy?.unlisted
            ? [{ label: 'شاغرة وغير معلنة', value: String(vacancy.unlisted) }]
            : []),
          { label: 'عقود عليها متأخرات', value: String(owed?.leases ?? 0) },
          ...(overdue ? [{ label: 'إجمالي المتأخرات', value: overdue }] : []),
        ],
        lines: lines.length ? ['الوحدات الشاغرة:', ...lines] : undefined,
        cta: { label: 'فتح لوحة التحكم', url: appLink('/ar/owner') },
        footnote: 'يصلك هذا الملخص صباح كل أحد.',
      }),
    });
  }
  return run;
}
