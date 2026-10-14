import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { contracts, invoiceLines, invoices, leases, parties, properties, units } from '@bhd-r/db';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  findRentDocSubject,
  isRentDocKey,
  rentDocHref,
  rentDocNumber,
  rentDocSubjects,
  rentMonthLabel,
  type RentDocSubject,
} from '@/lib/rent-documents';
import { RENT_PAYMENT_EVENT } from '@/lib/rent-documents-neon';
import { leaseStatementsInTx } from '@/lib/tenancy-neon';
import {
  canChargeTenants,
  canRecordTenantPayments,
  chargeableLease,
  muscatToday,
  recordChargePayment,
  settleRequestCharge,
  type ChargePaymentMethod,
} from '@/lib/tenant-charges-neon';
import { installmentInvoiceNumber } from '@/lib/tenant-ledger';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEASES_LIST_LIMIT = 200;
const COLLECTION_LEASE_STATUS = [
  'active',
  'cancel_requested',
  'clearance_pending',
  'ended',
  'terminated',
] as const;

function fail(code: string): never {
  throw new Error(code);
}

export type RentCollectionLease = {
  id: string;
  tenantName: string | null;
  unitCode: string | null;
  unitAr: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  contractReference: string | null;
  currency: string;
  status: string;
};

export type RentCollectionView = {
  leases: RentCollectionLease[];
  selected: { lease: RentCollectionLease; subjects: RentDocSubject[] } | null;
};

export function canViewRentCollection(claims: SessionClaims): boolean {
  return (
    canRecordTenantPayments(claims) ||
    canChargeTenants(claims) ||
    (Boolean(claims.organizationId) && hasPermission(claims, 'invoice.read'))
  );
}

/** The leases the viewer collects rent on, and every installment and bill of the chosen one. */
export async function loadRentCollection(
  claims: SessionClaims,
  leaseId: string | null,
): Promise<RentCollectionView> {
  if (!canViewRentCollection(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: leases.id,
        tenantPartyId: leases.tenantPartyId,
        tenantName: parties.displayName,
        unitCode: units.code,
        unitAr: units.nameAr,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        contractReference: contracts.reference,
        currency: leases.currency,
        status: leases.status,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .leftJoin(parties, eq(parties.id, leases.tenantPartyId))
      .leftJoin(contracts, eq(contracts.id, leases.contractId))
      .where(
        and(
          eq(leases.organizationId, orgId),
          inArray(leases.status, [...COLLECTION_LEASE_STATUS]),
          sql`coalesce(${contracts.payloadSnapshot}->'source'->>'type', '') <> 'stay_booking'`,
          ...(scoped ? [eq(properties.ownerPartyId, scoped)] : []),
        ),
      )
      .orderBy(asc(properties.nameAr), asc(units.code))
      .limit(LEASES_LIST_LIMIT);
    const list: RentCollectionLease[] = rows.map((row) => ({
      id: row.id,
      tenantName: row.tenantName,
      unitCode: row.unitCode,
      unitAr: row.unitAr,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      contractReference: row.contractReference,
      currency: row.currency,
      status: row.status,
    }));
    const chosen = rows.find((row) => row.id === leaseId) ?? rows[0];
    if (!chosen) return { leases: list, selected: null };
    const statement = (await leaseStatementsInTx(tx, orgId, [chosen.id], chosen.tenantPartyId)).get(
      chosen.id,
    );
    return {
      leases: list,
      selected: {
        lease: list.find((row) => row.id === chosen.id)!,
        subjects: statement ? rentDocSubjects(statement.statement) : [],
      },
    };
  });
}

const PAYMENT_METHOD_AR: Record<ChargePaymentMethod, string> = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
  cheque: 'شيك',
};

function arDate(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(isoDate)
    ? isoDate.slice(0, 10).split('-').reverse().join('/')
    : isoDate;
}

/**
 * Records that the tenant paid an installment or a bill on the lease (in full unless an amount is
 * given). An installment gets its own invoice on the first payment, so the statement, the receipt
 * and the arrears all read the same record. The tenant is emailed the signed receipt.
 */
export async function recordRentPayment(
  claims: SessionClaims,
  input: {
    leaseId: string;
    key: string;
    amountMinor?: string | undefined;
    method: ChargePaymentMethod;
    reference?: string | undefined;
    receivedOn?: string | undefined;
  },
) {
  if (!canRecordTenantPayments(claims)) fail('forbidden');
  if (!isRentDocKey(input.key) || input.key.startsWith('cheque-')) fail('tenant_charge_invalid');
  const today = muscatToday();
  if (input.receivedOn && (!ISO_DATE.test(input.receivedOn) || input.receivedOn > today)) {
    fail('tenant_charge_invalid');
  }
  const receivedAt =
    input.receivedOn && input.receivedOn !== today
      ? new Date(`${input.receivedOn}T12:00:00+04:00`)
      : undefined;
  const reference = input.reference?.trim().slice(0, 80) || null;
  const orgId = claims.organizationId!;

  const done = await withinViewerTenant(claims, async (tx) => {
    const lease = await chargeableLease(tx, claims, input.leaseId);
    const statement = (await leaseStatementsInTx(tx, orgId, [lease.id], lease.tenantPartyId)).get(
      lease.id,
    );
    const subject = statement ? findRentDocSubject(statement.statement, input.key) : null;
    if (!subject) fail('tenant_request_not_found');
    const outstanding = BigInt(subject.outstandingMinor);
    if (outstanding <= 0n) fail('tenant_charge_paid');
    const amount = input.amountMinor ? BigInt(input.amountMinor) : outstanding;
    if (amount <= 0n || amount > outstanding) fail('tenant_charge_invalid');

    const [contract] = await tx
      .select({ reference: contracts.reference })
      .from(leases)
      .innerJoin(contracts, eq(contracts.id, leases.contractId))
      .where(eq(leases.id, lease.id))
      .limit(1);

    let invoiceId = subject.invoiceId;
    if (!invoiceId) {
      const number = installmentInvoiceNumber(lease.id, subject.key);
      const total = BigInt(subject.amountMinor);
      const [created] = await tx
        .insert(invoices)
        .values({
          organizationId: orgId,
          leaseId: lease.id,
          tenantPartyId: lease.tenantPartyId,
          invoiceNumber: number,
          status: 'issued',
          currency: lease.currency,
          minorUnit: currencyMinorUnits[lease.currency as CurrencyCode] ?? 3,
          subtotalMinor: total,
          taxMinor: 0n,
          totalMinor: total,
          paidMinor: 0n,
          issuedOn: subject.dueOn < today ? subject.dueOn : today,
          dueOn: subject.dueOn,
          notes: null,
        })
        .onConflictDoNothing()
        .returning({ id: invoices.id });
      if (created) {
        await tx.insert(invoiceLines).values({
          organizationId: orgId,
          invoiceId: created.id,
          description: `${subject.label.ar} — ${rentMonthLabel(subject, true)}`.slice(0, 500),
          quantity: '1',
          unitAmountMinor: total,
          subtotalMinor: total,
          taxMinor: 0n,
          totalMinor: total,
        });
      }
      const [opened] = created
        ? [created]
        : await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(eq(invoices.organizationId, orgId), eq(invoices.invoiceNumber, number)))
            .limit(1);
      if (!opened) fail('tenant_charge_invalid');
      invoiceId = opened.id;
    }

    const paid = await recordChargePayment(tx, {
      orgId,
      actorUserId: claims.sub,
      invoiceId,
      amountMinor: amount,
      method: input.method,
      installment: true,
      ...(receivedAt ? { receivedAt } : {}),
      eventType: RENT_PAYMENT_EVENT,
      eventMetadata: { leaseId: lease.id, key: subject.key, reference },
    });
    if (paid.status === 'paid' && subject.kind === 'charge') {
      await settleRequestCharge(tx, {
        orgId,
        invoiceId,
        paidAt: paid.paidAt,
        actorUserId: claims.sub,
      });
    }
    return {
      ...paid,
      subject,
      amount,
      lease,
      receiptNumber: rentDocNumber('receipt', contract?.reference ?? null, lease.id, subject.key),
    };
  });

  const { subject, lease, amount, receiptNumber } = done;
  const left = BigInt(subject.amountMinor) - BigInt(done.paidMinor);
  const money = (minor: bigint | string) => formatMoney(minor.toString(), lease.currency, 'ar');
  const month = rentMonthLabel(subject, true);
  await notifyByEmail({
    orgId,
    aggregateType: 'invoice',
    aggregateId: done.invoiceId,
    audience: { parties: [lease.tenantPartyId] },
    content: () => ({
      tone: 'invoice',
      subject: `🧾 إيصال قبض: ${subject.label.ar} عن ${month} — ${receiptNumber}`,
      title: done.status === 'paid' ? 'استلمنا دفعتك كاملة، شكراً لك!' : 'سجّلنا دفعة على حسابك',
      intro:
        'سجّلت إدارة العقار استلام دفعتك، وإيصال القبض الموقّع إلكترونياً جاهز للتحميل في أي وقت:',
      details: [
        { label: 'رقم الإيصال', value: receiptNumber },
        { label: 'البند', value: subject.label.ar },
        { label: 'عن شهر', value: month },
        { label: 'المبلغ المستلم', value: money(amount) },
        { label: 'إجمالي المدفوع على البند', value: money(done.paidMinor) },
        { label: 'المتبقي', value: money(left > 0n ? left : 0n) },
        { label: 'طريقة السداد', value: PAYMENT_METHOD_AR[input.method] },
        { label: 'تاريخ الاستلام', value: arDate(input.receivedOn ?? today) },
      ],
      lines: [
        done.status === 'paid'
          ? 'هذا البند صار صافياً تماماً. احتفظ بالإيصال، فهو موقّع إلكترونياً ويمكن لأي جهة التحقق منه بمسح رمز QR.'
          : 'بقي جزء من المبلغ، وستجد فاتورة المطالبة بالمتبقي في كشف حسابك.',
      ],
      cta: {
        label: 'تحميل الإيصال',
        url: appLink(`/ar${rentDocHref('tenant', lease.id, subject.key, 'receipt')}`),
      },
    }),
  });

  return {
    invoiceId: done.invoiceId,
    status: done.status,
    paidMinor: done.paidMinor,
    receiptNumber,
    receiptHref: rentDocHref('owner', lease.id, subject.key, 'receipt'),
  };
}
