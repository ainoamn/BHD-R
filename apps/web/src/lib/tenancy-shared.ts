/** Client-safe shapes and alert rules for the signed-in account's own rentals and bookings. */
import { installmentKeyOf, type LeaseStatement } from '@/lib/tenant-ledger';
import type { TenantRequest } from '@/lib/tenant-requests-shared';

export type TenancyLandlord = { organizationId: string; ar: string; en: string };

export type TenancyContract = {
  id: string;
  landlord: TenancyLandlord;
  reference: string;
  kind: string;
  /** Parent contract when this row is an amendment / renewal addendum. */
  parentContractId: string | null;
  status: string;
  tenantSigned: boolean;
  startsOn: string | null;
  endsOn: string | null;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
  amountMinor: string | null;
  currency: string | null;
  /** Reference of the daily stay booking the contract was issued for. */
  stayReference: string | null;
  createdAt: string;
};

export type TenancyContractGroup = {
  root: TenancyContract;
  attachments: TenancyContract[];
};

/** One row per original contract; amendments hang off as attachments. */
export function tenancyContractGroups(contracts: TenancyContract[]): TenancyContractGroup[] {
  const byId = new Map(contracts.map((row) => [row.id, row]));
  const children = new Map<string, TenancyContract[]>();
  const roots: TenancyContract[] = [];
  for (const row of contracts) {
    if (row.parentContractId && byId.has(row.parentContractId)) {
      const list = children.get(row.parentContractId) ?? [];
      list.push(row);
      children.set(row.parentContractId, list);
    } else {
      roots.push(row);
    }
  }
  return roots.map((root) => ({
    root,
    attachments: (children.get(root.id) ?? []).slice().sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  }));
}

export function tenancyContractKindLabel(kind: string, ar: boolean): string {
  if (kind === 'renewal') return ar ? 'تجديد' : 'Renewal';
  if (kind === 'amendment') return ar ? 'تعديل تواريخ' : 'Date change';
  if (kind === 'termination') return ar ? 'إنهاء' : 'Termination';
  return ar ? 'عقد أساسي' : 'Initial';
}

export type TenancyLease = {
  id: string;
  contractId: string | null;
  landlord: TenancyLandlord;
  status: string;
  startsOn: string;
  endsOn: string;
  rentMinor: string;
  currency: string;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
  /** Issued for a daily stay rather than a long-term rental. */
  fromStay: boolean;
};

export type TenancyInvoice = {
  id: string;
  landlord: TenancyLandlord;
  number: string;
  status: string;
  issuedOn: string;
  dueOn: string;
  totalMinor: string;
  paidMinor: string;
  currency: string;
};

export type TenancyPayment = {
  id: string;
  landlord: TenancyLandlord;
  invoiceNumber: string;
  status: string;
  method: string;
  amountMinor: string;
  refundedMinor: string;
  currency: string;
  receivedAt: string;
};

export type TenancyReservation = {
  id: string;
  landlord: TenancyLandlord;
  referenceCode: string | null;
  mode: 'rent' | 'sale' | null;
  status: string;
  /** Premises handed over by scan: awaiting the tenant's acceptance, or open for defect photos. */
  handover?: 'awaiting_acceptance' | 'defects_open' | null;
  expiresAt: string;
  awaitingPayment: boolean;
  depositMinor: string | null;
  currency: string | null;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
};

export type TenancyStay = {
  id: string;
  referenceCode: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  totalMinor: string;
  currency: string;
  titleAr: string | null;
  titleEn: string | null;
  canRequestDepositRefund: boolean;
};

/** Property viewing requests the signed-in guest submitted (or was linked to). */
export type TenancyViewing = {
  id: string;
  landlord: TenancyLandlord;
  reference: string;
  status: string;
  scheduledAt: string | null;
  preferredAt: string | null;
  createdAt: string;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  /** Locale-less path to the visit pass when the appointment is still open. */
  passHref: string | null;
};

/** One lease's account: installments by due date, what was paid, overdue and remaining. */
export type TenancyStatement = {
  leaseId: string;
  contractId: string | null;
  contractReference: string | null;
  landlord: TenancyLandlord;
  status: string;
  startsOn: string;
  endsOn: string;
  currency: string;
  unitCode: string | null;
  unitAr: string | null;
  unitEn: string | null;
  propertyId: string | null;
  /** The landlord stops ordinary maintenance requests until the arrears are settled. */
  maintenanceBlocked: boolean;
  statement: LeaseStatement;
};

export type TenancyAlertKind =
  | 'contract_sign'
  | 'rent_overdue'
  | 'invoice_overdue'
  | 'invoice_due'
  | 'lease_expiring'
  | 'reservation_payment'
  | 'reservation_review'
  | 'stay_payment'
  | 'stay_request'
  | 'stay_refund'
  | 'handover_accept'
  | 'handover_defects'
  | 'viewing_scheduled'
  | 'viewing_pending';

export type TenancyAlert = {
  kind: TenancyAlertKind;
  id: string;
  reference: string;
  /** Locale-less app path. */
  href: string;
  date: string | null;
  amountMinor: string | null;
  currency: string | null;
  /** The tenant has to do something (sign, pay, request). */
  action: boolean;
};

export type MyTenancy = {
  contracts: TenancyContract[];
  leases: TenancyLease[];
  invoices: TenancyInvoice[];
  payments: TenancyPayment[];
  reservations: TenancyReservation[];
  stays: TenancyStay[];
  viewings: TenancyViewing[];
  statements: TenancyStatement[];
  requests: TenantRequest[];
  alerts: TenancyAlert[];
};

export const EMPTY_TENANCY: MyTenancy = {
  contracts: [],
  leases: [],
  invoices: [],
  payments: [],
  reservations: [],
  stays: [],
  viewings: [],
  statements: [],
  requests: [],
  alerts: [],
};

export function viewingHref(viewing: Pick<TenancyViewing, 'passHref'>): string | null {
  return viewing.passHref;
}

const INVOICE_DUE_SOON_DAYS = 14;
const LEASE_EXPIRY_DAYS = 60;
const OPEN_INVOICE = new Set(['issued', 'partially_paid', 'overdue']);
const SIGNABLE_CONTRACT = new Set(['sent', 'partially_signed']);
const LIVE_LEASE = new Set(['active', 'cancel_requested', 'clearance_pending']);

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function invoiceOutstandingMinor(invoice: TenancyInvoice): string {
  const left = BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor);
  return (left > 0n ? left : 0n).toString();
}

export function stayHref(stay: Pick<TenancyStay, 'id' | 'referenceCode'>): string {
  return `/guest/stays/${encodeURIComponent(stay.id)}?ref=${encodeURIComponent(stay.referenceCode)}`;
}

export function reservationHref(reservation: TenancyReservation): string | null {
  return reservation.referenceCode
    ? `/book/sign?ref=${encodeURIComponent(reservation.referenceCode)}`
    : null;
}

/** What needs the tenant's attention, most urgent first. `today` is YYYY-MM-DD. */
export function buildTenancyAlerts(data: Omit<MyTenancy, 'alerts'>, today: string): TenancyAlert[] {
  const alerts: TenancyAlert[] = [];
  for (const contract of data.contracts) {
    if (!SIGNABLE_CONTRACT.has(contract.status) || contract.tenantSigned) continue;
    alerts.push({
      kind: 'contract_sign',
      id: contract.id,
      reference: contract.reference,
      href: `/tenant/contracts/${contract.id}`,
      date: contract.startsOn,
      amountMinor: contract.amountMinor,
      currency: contract.currency,
      action: true,
    });
  }
  for (const item of data.statements ?? []) {
    if (item.statement.overdueMinor === '0') continue;
    alerts.push({
      kind: 'rent_overdue',
      id: item.leaseId,
      reference: item.contractReference ?? item.unitCode ?? item.leaseId.slice(0, 8),
      href: '/tenant/invoices',
      date: null,
      amountMinor: item.statement.overdueMinor,
      currency: item.currency,
      action: true,
    });
  }
  const dueSoon = addDays(today, INVOICE_DUE_SOON_DAYS);
  for (const invoice of data.invoices) {
    if (!OPEN_INVOICE.has(invoice.status) || installmentKeyOf(invoice.number)) continue;
    const overdue = invoice.status === 'overdue' || invoice.dueOn < today;
    if (!overdue && invoice.dueOn > dueSoon) continue;
    alerts.push({
      kind: overdue ? 'invoice_overdue' : 'invoice_due',
      id: invoice.id,
      reference: invoice.number,
      href: '/tenant/invoices',
      date: invoice.dueOn,
      amountMinor: invoiceOutstandingMinor(invoice),
      currency: invoice.currency,
      action: true,
    });
  }
  const expiryCutoff = addDays(today, LEASE_EXPIRY_DAYS);
  for (const lease of data.leases) {
    if (lease.fromStay || !LIVE_LEASE.has(lease.status)) continue;
    if (lease.endsOn < today || lease.endsOn > expiryCutoff) continue;
    alerts.push({
      kind: 'lease_expiring',
      id: lease.id,
      reference: lease.unitCode ?? lease.id.slice(0, 8),
      href: '/tenant/leases',
      date: lease.endsOn,
      amountMinor: null,
      currency: null,
      action: false,
    });
  }
  for (const reservation of data.reservations) {
    if (reservation.handover && reservation.referenceCode) {
      alerts.push({
        kind:
          reservation.handover === 'awaiting_acceptance' ? 'handover_accept' : 'handover_defects',
        id: reservation.id,
        reference: reservation.referenceCode,
        href: `/book/confirmed?ref=${encodeURIComponent(reservation.referenceCode)}`,
        date: null,
        amountMinor: null,
        currency: null,
        action: true,
      });
      continue;
    }
    if (reservation.status !== 'pending' && reservation.status !== 'confirmed') continue;
    const awaitingPayment = reservation.status === 'pending' && reservation.awaitingPayment;
    alerts.push({
      kind: awaitingPayment ? 'reservation_payment' : 'reservation_review',
      id: reservation.id,
      reference: reservation.referenceCode ?? reservation.id.slice(0, 8),
      href: reservationHref(reservation) ?? '/tenant/reservations',
      date: reservation.expiresAt.slice(0, 10),
      amountMinor: reservation.depositMinor,
      currency: reservation.currency,
      action: awaitingPayment,
    });
  }
  for (const stay of data.stays) {
    const kind: TenancyAlertKind | null =
      stay.status === 'payment_pending' || stay.status === 'payment_failed'
        ? 'stay_payment'
        : stay.status === 'request_pending'
          ? 'stay_request'
          : stay.canRequestDepositRefund
            ? 'stay_refund'
            : null;
    if (!kind) continue;
    alerts.push({
      kind,
      id: stay.id,
      reference: stay.referenceCode,
      href: stayHref(stay),
      date: stay.checkInOn,
      amountMinor: kind === 'stay_payment' ? stay.totalMinor : null,
      currency: kind === 'stay_payment' ? stay.currency : null,
      action: kind !== 'stay_request',
    });
  }
  for (const viewing of data.viewings ?? []) {
    if (viewing.status === 'scheduled') {
      alerts.push({
        kind: 'viewing_scheduled',
        id: viewing.id,
        reference: viewing.reference,
        href: viewing.passHref ?? '/tenant/reservations',
        date: viewing.scheduledAt?.slice(0, 10) ?? null,
        amountMinor: null,
        currency: null,
        action: Boolean(viewing.passHref),
      });
      continue;
    }
    if (viewing.status === 'requested') {
      alerts.push({
        kind: 'viewing_pending',
        id: viewing.id,
        reference: viewing.reference,
        href: '/tenant/reservations',
        date: (viewing.preferredAt ?? viewing.createdAt).slice(0, 10),
        amountMinor: null,
        currency: null,
        action: false,
      });
    }
  }
  const rank: Record<TenancyAlertKind, number> = {
    handover_accept: -2,
    handover_defects: -1,
    rent_overdue: 0,
    invoice_overdue: 0,
    contract_sign: 1,
    reservation_payment: 2,
    stay_payment: 3,
    viewing_scheduled: 3,
    invoice_due: 4,
    stay_refund: 5,
    lease_expiring: 6,
    reservation_review: 7,
    stay_request: 8,
    viewing_pending: 9,
  };
  return alerts.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || (a.date ?? '').localeCompare(b.date ?? ''),
  );
}

const ALERT_LABEL: Record<TenancyAlertKind, { ar: string; en: string }> = {
  contract_sign: { ar: 'عقد بانتظار توقيعك', en: 'Contract awaiting your signature' },
  rent_overdue: { ar: 'مبالغ متأخرة على عقد الإيجار', en: 'Overdue amounts on your lease' },
  invoice_overdue: { ar: 'فاتورة متأخرة السداد', en: 'Overdue invoice' },
  invoice_due: { ar: 'فاتورة مستحقة قريباً', en: 'Invoice due soon' },
  lease_expiring: { ar: 'عقد إيجار ينتهي قريباً', en: 'Lease ending soon' },
  reservation_payment: { ar: 'أكمل دفع ضمان الحجز', en: 'Complete the booking deposit' },
  reservation_review: {
    ar: 'حجز بانتظار إعداد العقد من المالك',
    en: 'Booking awaiting the owner’s contract',
  },
  stay_payment: { ar: 'إقامة بانتظار الدفع', en: 'Stay awaiting payment' },
  stay_request: { ar: 'طلب إقامة بانتظار موافقة المالك', en: 'Stay request awaiting the host' },
  stay_refund: { ar: 'يمكنك طلب استرداد التأمين', en: 'You can request your deposit back' },
  handover_accept: {
    ar: 'أكّد استلامك للعقار',
    en: 'Confirm you received the premises',
  },
  handover_defects: {
    ar: 'ارفع صور العقار خلال 3 ساعات',
    en: 'Report defects within 3 hours',
  },
  viewing_scheduled: {
    ar: 'موعد معاينة مؤكّد — افتح بطاقة الزيارة',
    en: 'Viewing confirmed — open your visit pass',
  },
  viewing_pending: {
    ar: 'طلب معاينة بانتظار رد المالك',
    en: 'Viewing request awaiting the owner',
  },
};

export function tenancyAlertLabel(kind: TenancyAlertKind, ar: boolean): string {
  const label = ALERT_LABEL[kind];
  return ar ? label.ar : label.en;
}

export function tenancyUnitLabel(
  item: { unitCode: string | null; unitAr: string | null; unitEn: string | null },
  ar: boolean,
): string {
  const name = ar ? item.unitAr || item.unitEn : item.unitEn || item.unitAr;
  return name || item.unitCode || '—';
}

export function tenancyLandlordName(landlord: TenancyLandlord, ar: boolean): string {
  return ar ? landlord.ar || landlord.en : landlord.en || landlord.ar;
}

export function hasTenancy(data: MyTenancy): boolean {
  return Boolean(
    data.contracts.length ||
    data.leases.length ||
    data.invoices.length ||
    data.reservations.length ||
    data.stays.length ||
    data.viewings.length,
  );
}
