import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  invoiceLines,
  invoices,
  leases,
  operationalRequests,
  parties,
  payments,
  properties,
  units,
  workflowEvents,
} from '@bhd-r/db';
import { ensureAccountCodeMap, postSourceDocumentInTx } from '@/lib/accounting-gl-neon';
import { channelFromMethod, postingRentReceipt } from '@/lib/accounting-posting';
import { appLink, notifyByEmail } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  CHARGE_CATEGORIES,
  chargeCategoryOf,
  chargeInvoiceNumber,
  chargeLabel,
  type ChargeCategory,
} from '@/lib/tenant-charges-shared';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHARGES_LIST_LIMIT = 100;
const LEASES_LIST_LIMIT = 200;
const AMOUNT_MAX = 100_000_000n;
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque'] as const;
export type ChargePaymentMethod = (typeof PAYMENT_METHODS)[number];

function fail(code: string): never {
  throw new Error(code);
}

export function muscatToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

/** Who may bill tenants: holders of `invoice.create`, and an owner on their own buildings. */
export function canChargeTenants(claims: SessionClaims): boolean {
  return (
    Boolean(claims.organizationId) &&
    (hasPermission(claims, 'invoice.create') ||
      (claims.roles.includes('property_owner') && Boolean(ownerPartyScope(claims))))
  );
}

/** Who may record that a tenant paid a charge. */
export function canRecordTenantPayments(claims: SessionClaims): boolean {
  return (
    Boolean(claims.organizationId) &&
    (hasPermission(claims, 'payment.record') ||
      (claims.roles.includes('property_owner') && Boolean(ownerPartyScope(claims))))
  );
}

function amountOf(value: string): bigint {
  if (!/^\d{1,12}$/.test(value)) fail('tenant_charge_invalid');
  const amount = BigInt(value);
  if (amount <= 0n || amount > AMOUNT_MAX) fail('tenant_charge_invalid');
  return amount;
}

/** A lease of the organization the viewer may bill, with its tenant and property. */
export async function chargeableLease(tx: Tx, claims: SessionClaims, leaseId: string) {
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  const [row] = await tx
    .select({
      id: leases.id,
      tenantPartyId: leases.tenantPartyId,
      currency: leases.currency,
      unitId: leases.unitId,
      propertyId: units.propertyId,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(leases.id, leaseId),
        eq(leases.organizationId, orgId),
        ...(scoped ? [eq(properties.ownerPartyId, scoped)] : []),
      ),
    )
    .limit(1);
  if (!row) fail('tenant_request_not_found');
  return row;
}

/** Bills the tenant of a lease: one issued invoice with one line, numbered by category. */
export async function insertChargeInvoice(
  tx: Tx,
  input: {
    orgId: string;
    actorUserId: string;
    leaseId: string;
    tenantPartyId: string;
    currency: string;
    category: ChargeCategory;
    amountMinor: bigint;
    dueOn: string;
    description: string;
    notes: string | null;
  },
) {
  const today = muscatToday();
  const minorUnit = currencyMinorUnits[input.currency as CurrencyCode] ?? 3;
  const number = chargeInvoiceNumber(input.category, today, randomBytes(4).toString('hex'));
  const [invoice] = await tx
    .insert(invoices)
    .values({
      organizationId: input.orgId,
      leaseId: input.leaseId,
      tenantPartyId: input.tenantPartyId,
      invoiceNumber: number,
      status: 'issued',
      currency: input.currency,
      minorUnit,
      subtotalMinor: input.amountMinor,
      taxMinor: 0n,
      totalMinor: input.amountMinor,
      paidMinor: 0n,
      issuedOn: input.dueOn < today ? input.dueOn : today,
      dueOn: input.dueOn,
      notes: input.notes,
    })
    .returning({ id: invoices.id, dueOn: invoices.dueOn });
  if (!invoice) fail('create_failed');
  await tx.insert(invoiceLines).values({
    organizationId: input.orgId,
    invoiceId: invoice.id,
    description: input.description.slice(0, 500),
    quantity: '1',
    unitAmountMinor: input.amountMinor,
    subtotalMinor: input.amountMinor,
    taxMinor: 0n,
    totalMinor: input.amountMinor,
  });
  await tx.insert(workflowEvents).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    resourceType: 'invoice',
    resourceId: invoice.id,
    eventType: 'tenant_charge.created',
    toStatus: 'issued',
    metadata: {
      invoiceNumber: number,
      category: input.category,
      amountMinor: input.amountMinor.toString(),
      leaseId: input.leaseId,
    },
  });
  return { id: invoice.id, number, dueOn: String(invoice.dueOn), minorUnit };
}

/**
 * Records a manual payment on a charge invoice (or, with `installment`, on the invoice of a contract
 * installment); paid in full unless an amount is given.
 */
export async function recordChargePayment(
  tx: Tx,
  input: {
    orgId: string;
    actorUserId: string;
    invoiceId: string;
    amountMinor?: bigint | undefined;
    method: ChargePaymentMethod;
    installment?: boolean;
    receivedAt?: Date;
    eventType?: string;
    eventMetadata?: Record<string, unknown>;
  },
) {
  const [invoice] = await tx
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      status: invoices.status,
      currency: invoices.currency,
      minorUnit: invoices.minorUnit,
      totalMinor: invoices.totalMinor,
      paidMinor: invoices.paidMinor,
    })
    .from(invoices)
    .where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.orgId)))
    .for('update')
    .limit(1);
  if (!invoice || (!input.installment && !chargeCategoryOf(invoice.number))) {
    fail('tenant_request_not_found');
  }
  if (invoice.status === 'void') fail('tenant_charge_invalid');
  const left = invoice.totalMinor - invoice.paidMinor;
  if (left <= 0n || invoice.status === 'paid') fail('tenant_charge_paid');
  const amount = input.amountMinor ?? left;
  if (amount <= 0n || amount > left) fail('tenant_charge_invalid');
  const paid = invoice.paidMinor + amount;
  const status = paid >= invoice.totalMinor ? 'paid' : 'partially_paid';
  const now = new Date();
  const receivedAt = input.receivedAt ?? now;
  const [payment] = await tx
    .insert(payments)
    .values({
      organizationId: input.orgId,
      invoiceId: invoice.id,
      status: 'succeeded',
      amountMinor: amount,
      currency: invoice.currency,
      minorUnit: invoice.minorUnit,
      provider: 'manual',
      providerReference: `manual:${invoice.id}:${randomUUID()}`,
      method: input.method,
      receivedAt,
    })
    .returning({ id: payments.id });
  await tx
    .update(invoices)
    .set({ paidMinor: paid, status, updatedAt: now })
    .where(eq(invoices.id, invoice.id));
  await tx.insert(workflowEvents).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    resourceType: 'invoice',
    resourceId: invoice.id,
    eventType: input.eventType ?? 'tenant_charge.payment_recorded',
    fromStatus: invoice.status,
    toStatus: status,
    metadata: {
      ...input.eventMetadata,
      invoiceNumber: invoice.number,
      paymentId: payment?.id ?? null,
      amountMinor: amount.toString(),
      method: input.method,
    },
  });
  return {
    invoiceId: invoice.id,
    paymentId: payment?.id ?? null,
    status,
    paidMinor: paid.toString(),
    paidAt: receivedAt.toISOString(),
  };
}

export type TenantChargeView = {
  id: string;
  number: string;
  category: ChargeCategory;
  description: string | null;
  status: string;
  currency: string;
  totalMinor: string;
  paidMinor: string;
  issuedOn: string;
  dueOn: string;
  tenantName: string | null;
  unitCode: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
};

export type ChargeableLease = {
  id: string;
  tenantName: string | null;
  unitCode: string | null;
  unitAr: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  currency: string;
};

/** Recent charges on tenants and the leases the viewer may bill, for the owner's charges tab. */
export async function listTenantCharges(claims: SessionClaims): Promise<{
  charges: TenantChargeView[];
  leases: ChargeableLease[];
}> {
  if (!canChargeTenants(claims) && !canRecordTenantPayments(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const ownScope = scoped ? [eq(properties.ownerPartyId, scoped)] : [];
    const [chargeRows, leaseRows] = await Promise.all([
      tx
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          status: invoices.status,
          currency: invoices.currency,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          issuedOn: invoices.issuedOn,
          dueOn: invoices.dueOn,
          description: sql<string | null>`(select ${invoiceLines.description} from ${invoiceLines}
            where ${invoiceLines.invoiceId} = ${invoices.id} limit 1)`,
          tenantName: parties.displayName,
          unitCode: units.code,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
        })
        .from(invoices)
        .innerJoin(leases, eq(leases.id, invoices.leaseId))
        .innerJoin(units, eq(units.id, leases.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .leftJoin(parties, eq(parties.id, invoices.tenantPartyId))
        .where(
          and(
            eq(invoices.organizationId, orgId),
            or(
              ...['ELC', 'WTR', 'MNT', 'DMG', 'SRV', 'CHG'].map((prefix) =>
                like(invoices.invoiceNumber, `${prefix}-%`),
              ),
            ),
            ...ownScope,
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(CHARGES_LIST_LIMIT),
      tx
        .select({
          id: leases.id,
          tenantName: parties.displayName,
          unitCode: units.code,
          unitAr: units.nameAr,
          propertyNameAr: properties.nameAr,
          propertyNameEn: properties.nameEn,
          currency: leases.currency,
        })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .leftJoin(parties, eq(parties.id, leases.tenantPartyId))
        .where(
          and(
            eq(leases.organizationId, orgId),
            inArray(leases.status, ['active', 'cancel_requested', 'clearance_pending']),
            ...ownScope,
          ),
        )
        .orderBy(properties.nameAr, units.code)
        .limit(LEASES_LIST_LIMIT),
    ]);
    return {
      charges: chargeRows.map((row) => ({
        id: row.id,
        number: row.number,
        category: chargeCategoryOf(row.number) ?? 'other',
        description: row.description,
        status: row.status,
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
        paidMinor: row.paidMinor.toString(),
        issuedOn: String(row.issuedOn),
        dueOn: String(row.dueOn),
        tenantName: row.tenantName,
        unitCode: row.unitCode,
        propertyNameAr: row.propertyNameAr,
        propertyNameEn: row.propertyNameEn,
      })),
      leases: leaseRows,
    };
  });
}

/** A charge on a tenant from the owner's charges tab: a utility bill, damage, a service fee. */
export async function createTenantCharge(
  claims: SessionClaims,
  input: {
    leaseId: string;
    category: ChargeCategory;
    amountMinor: string;
    dueOn: string;
    description?: string | undefined;
  },
) {
  if (!canChargeTenants(claims)) fail('forbidden');
  if (!CHARGE_CATEGORIES.includes(input.category) || !ISO_DATE.test(input.dueOn)) {
    fail('tenant_charge_invalid');
  }
  const amount = amountOf(input.amountMinor);
  const orgId = claims.organizationId!;
  const { invoice, lease, description } = await withinViewerTenant(claims, async (tx) => {
    const lease = await chargeableLease(tx, claims, input.leaseId);
    const description =
      input.description?.trim().slice(0, 300) || chargeLabel(input.category, true);
    const invoice = await insertChargeInvoice(tx, {
      orgId,
      actorUserId: claims.sub,
      leaseId: lease.id,
      tenantPartyId: lease.tenantPartyId,
      currency: lease.currency,
      category: input.category,
      amountMinor: amount,
      dueOn: input.dueOn,
      description,
      notes: null,
    });
    return { invoice, lease, description };
  });
  await notifyByEmail({
    orgId,
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    audience: { parties: [lease.tenantPartyId] },
    content: () => ({
      tone: 'invoice',
      subject: `🧾 مطالبة جديدة: ${chargeLabel(input.category, true)} — ${invoice.number}`,
      title: 'وصلتك مطالبة جديدة على عقدك',
      intro: 'أصدرت إدارة العقار مطالبة جديدة على عقد إيجارك، وهذه تفاصيلها:',
      details: [
        { label: 'رقم الفاتورة', value: invoice.number },
        { label: 'النوع', value: chargeLabel(input.category, true) },
        { label: 'البيان', value: description },
        { label: 'المبلغ', value: formatMoney(amount.toString(), lease.currency, 'ar') },
        { label: 'تاريخ الاستحقاق', value: arDate(invoice.dueOn) },
      ],
      lines: ['يمكنك مراجعتها في كشف حسابك، والسداد قبل الموعد يجعل يومك (ويومنا) أجمل.'],
      cta: { label: 'فتح كشف الحساب', url: appLink('/ar/tenant/invoices') },
    }),
  });
  return invoice;
}

function arDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso;
}

/** Records a tenant's payment on a charge from the charges tab. */
export async function payTenantCharge(
  claims: SessionClaims,
  invoiceId: string,
  input: { amountMinor?: string | undefined; method: ChargePaymentMethod },
) {
  if (!canRecordTenantPayments(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const scoped = ownerPartyScope(claims);
  const paid = await withinViewerTenant(claims, async (tx) => {
    if (scoped) {
      const [own] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .innerJoin(leases, eq(leases.id, invoices.leaseId))
        .innerJoin(units, eq(units.id, leases.unitId))
        .innerJoin(properties, eq(properties.id, units.propertyId))
        .where(
          and(
            eq(invoices.id, invoiceId),
            eq(invoices.organizationId, orgId),
            eq(properties.ownerPartyId, scoped),
          ),
        )
        .limit(1);
      if (!own) fail('tenant_request_not_found');
    }
    const paid = await recordChargePayment(tx, {
      orgId,
      actorUserId: claims.sub,
      invoiceId,
      amountMinor: input.amountMinor ? amountOf(input.amountMinor) : undefined,
      method: input.method,
    });
    if (paid.status === 'paid') {
      await settleRequestCharge(tx, {
        orgId,
        invoiceId,
        paidAt: paid.paidAt,
        actorUserId: claims.sub,
      });
    }
    const [invoice] = await tx
      .select({
        number: invoices.invoiceNumber,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        tenantPartyId: invoices.tenantPartyId,
        leaseId: invoices.leaseId,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (paid.paymentId && invoice?.leaseId) {
      const [lease] = await tx
        .select({
          unitId: leases.unitId,
          propertyId: units.propertyId,
          currency: leases.currency,
          tenantPartyId: leases.tenantPartyId,
        })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(leases.id, invoice.leaseId))
        .limit(1);
      const [paymentRow] = await tx
        .select({ amountMinor: payments.amountMinor })
        .from(payments)
        .where(eq(payments.id, paid.paymentId))
        .limit(1);
      const minor = paymentRow?.amountMinor?.toString() ?? '';
      if (lease && /^[1-9]\d*$/.test(minor)) {
        const map = await ensureAccountCodeMap(tx, orgId);
        await postSourceDocumentInTx(tx, {
          organizationId: orgId,
          actorUserId: claims.sub,
          occurredOn: muscatToday(),
          description: `تحصيل مطالبة ${invoice.number}`.slice(0, 500),
          sourceType: 'tenant_charge_payment',
          sourceId: paid.paymentId,
          lines: postingRentReceipt(
            map,
            minor,
            {
              currency: lease.currency,
              partyId: lease.tenantPartyId,
              propertyId: lease.propertyId,
              unitId: lease.unitId,
            },
            channelFromMethod(input.method),
            invoice.number,
          ),
        });
      }
    }
    return { ...paid, invoice: invoice ?? null };
  });
  const { invoice, ...result } = paid;
  if (invoice) {
    const left = invoice.totalMinor - BigInt(result.paidMinor);
    await notifyByEmail({
      orgId,
      aggregateType: 'invoice',
      aggregateId: invoiceId,
      audience: { parties: [invoice.tenantPartyId] },
      content: () => ({
        tone: 'invoice',
        subject: `✅ استلمنا دفعتك — ${invoice.number}`,
        title: result.status === 'paid' ? 'تم السداد بالكامل، شكراً لك!' : 'سجّلنا دفعة على حسابك',
        intro: 'سُجّلت دفعتك في حسابك لدى إدارة العقار.',
        details: [
          { label: 'رقم الفاتورة', value: invoice.number },
          { label: 'إجمالي ما سُدد', value: formatMoney(result.paidMinor, invoice.currency, 'ar') },
          {
            label: 'المتبقي',
            value: formatMoney((left > 0n ? left : 0n).toString(), invoice.currency, 'ar'),
          },
          { label: 'طريقة السداد', value: PAYMENT_METHOD_AR[input.method] },
        ],
        lines: [
          result.status === 'paid'
            ? 'حسابك على هذه الفاتورة صافٍ تماماً. نحب هذا النوع من الأخبار 😄'
            : 'بقي جزء صغير، ونحن واثقون أنك ستنهيه قريباً.',
        ],
        cta: { label: 'فتح كشف الحساب', url: appLink('/ar/tenant/invoices') },
      }),
    });
  }
  return result;
}

const PAYMENT_METHOD_AR: Record<ChargePaymentMethod, string> = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
  cheque: 'شيك',
};

/**
 * Once a maintenance charge is paid in full, its request notes it; a request that waited for the
 * payment before the work goes back to approved.
 */
export async function settleRequestCharge(
  tx: Tx,
  input: { orgId: string; invoiceId: string; paidAt: string; actorUserId: string },
): Promise<{ requestId: string; status: string } | null> {
  const [row] = await tx
    .select({
      id: operationalRequests.id,
      status: operationalRequests.status,
      metadata: operationalRequests.metadata,
      reference: operationalRequests.reference,
    })
    .from(operationalRequests)
    .where(
      and(
        eq(operationalRequests.organizationId, input.orgId),
        sql`${operationalRequests.metadata}->'charge'->>'invoiceId' = ${input.invoiceId}`,
      ),
    )
    .for('update')
    .limit(1);
  if (!row) return null;
  const data =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const charge =
    data.charge && typeof data.charge === 'object' ? (data.charge as Record<string, unknown>) : {};
  const reopen = row.status === 'on_hold' && charge.payment === 'before_work';
  const status = reopen ? 'approved' : row.status;
  const replies: unknown[] = Array.isArray(data.replies) ? (data.replies as unknown[]) : [];
  await tx
    .update(operationalRequests)
    .set({
      status,
      metadata: {
        ...data,
        charge: { ...charge, paidAt: input.paidAt },
        replies: [
          ...replies,
          {
            at: input.paidAt,
            by: 'owner',
            name: null,
            note: reopen
              ? 'سُجّل سداد تكلفة الصيانة؛ يُستأنف تنفيذ الطلب.'
              : 'سُجّل سداد تكلفة الصيانة.',
            ...(reopen ? { status } : {}),
          },
        ].slice(-40),
      },
      updatedAt: new Date(),
    })
    .where(eq(operationalRequests.id, row.id));
  await tx.insert(workflowEvents).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    resourceType: 'operational_request',
    resourceId: row.id,
    eventType: 'tenant_request.charge_paid',
    fromStatus: row.status,
    toStatus: status,
    metadata: { reference: row.reference, invoiceId: input.invoiceId },
  });
  return { requestId: row.id, status };
}
