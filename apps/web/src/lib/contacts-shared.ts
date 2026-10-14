import type { BadgeChip } from '@/lib/badges-shared';
import type { IdentityMark } from '@/lib/identity-shared';

export const CONTACT_ROLE_KEYS = [
  'owner',
  'tenant',
  'prospect',
  'supplier',
  'partner',
  'government',
  'authorized_representative',
  'lawyer',
  'other',
] as const;

export type ContactRoleKey = (typeof CONTACT_ROLE_KEYS)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRoleKey, { ar: string; en: string }> = {
  owner: { ar: 'مالك', en: 'Owner' },
  tenant: { ar: 'مستأجر', en: 'Tenant' },
  prospect: { ar: 'عميل محتمل', en: 'Prospect' },
  supplier: { ar: 'مورّد', en: 'Supplier' },
  partner: { ar: 'شريك', en: 'Partner' },
  government: { ar: 'جهة حكومية', en: 'Government' },
  authorized_representative: { ar: 'مفوّض', en: 'Representative' },
  lawyer: { ar: 'محامٍ', en: 'Lawyer' },
  other: { ar: 'أخرى', en: 'Other' },
};

/** Arabic counted noun: plural for 3–10, singular otherwise. */
export function arPlural(count: number, singular: string, plural: string): string {
  return count >= 3 && count <= 10 ? plural : singular;
}

export function contactRoleLabel(role: string, ar: boolean): string {
  const label = CONTACT_ROLE_LABELS[role as ContactRoleKey];
  return label ? (ar ? label.ar : label.en) : role;
}

export type ContactSummary = {
  id: string;
  displayName: string;
  type: 'person' | 'company';
  email: string | null;
  phone: string | null;
  status: string;
  roles: string[];
  /** Properties the party owns. */
  properties: number;
  /** Active leases the party holds as tenant. */
  activeLeases: number;
  contracts: number;
  openLegal: number;
  member: boolean;
  mark?: IdentityMark;
  /** Current awards as an owner and as a tenant. */
  badges?: BadgeChip[];
};

/** Sums by currency, in minor units. */
export type MoneyTotals = { currency: string; minor: string }[];

export type ContactMoneyLine = {
  key:
    | 'stay_payments'
    | 'reservation_deposits'
    | 'invoice_payments'
    | 'deposit_refunds'
    | 'vendor_expenses'
    | 'invoices_due'
    | 'property_stays'
    | 'property_deposits'
    | 'property_invoices'
    | 'property_expenses';
  currency: string;
  minor: string;
  count: number;
};

export type ContactAddress = {
  governorate: string;
  wilayat: string;
  city: string;
  area: string | null;
  street: string | null;
  buildingNumber: string | null;
  postalCode: string | null;
};

export type ContactPlace = {
  propertyId: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  unitCode: string | null;
};

export type ContactDetail = {
  party: {
    id: string;
    displayName: string;
    type: 'person' | 'company';
    email: string | null;
    phone: string | null;
    status: string;
    roles: string[];
    notes: string | null;
    source: string | null;
    createdAt: string;
    member: boolean;
    address: ContactAddress | null;
    mark?: IdentityMark;
    badges?: BadgeChip[];
  };
  canEdit: boolean;
  owned: {
    propertyId: string;
    nameAr: string;
    nameEn: string | null;
    category: string;
    units: number;
    leased: number;
    shareBasisPoints: number | null;
  }[];
  leases: (ContactPlace & {
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    rentMinor: string;
    currency: string;
    contractId: string | null;
  })[];
  contracts: (ContactPlace & {
    id: string;
    reference: string | null;
    status: string;
    side: 'owner' | 'tenant';
    contractType: 'lease' | 'sale';
    createdAt: string;
  })[];
  reservations: (ContactPlace & {
    id: string;
    reference: string | null;
    mode: 'lease' | 'sale';
    status: string;
    depositMinor: string | null;
    currency: string | null;
    paidAt: string | null;
  })[];
  stays: (ContactPlace & {
    id: string;
    reference: string;
    status: string;
    checkInOn: string;
    checkOutOn: string;
    totalMinor: string;
    currency: string;
  })[];
  maintenance: (ContactPlace & {
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
  })[];
  legal: {
    id: string;
    reference: string;
    title: string;
    status: string;
    side: 'counterparty' | 'lawyer';
    claimMinor: string;
    recoveredMinor: string;
    currency: string;
    nextHearingAt: string | null;
  }[];
  money: {
    /** Paid by the party: stays, booking deposits, invoices. */
    received: MoneyTotals;
    /** Paid to the party: deposit refunds, vendor expenses. */
    paid: MoneyTotals;
    /** Still owed on issued invoices. */
    outstanding: MoneyTotals;
    /** Collected on the properties the party owns. */
    propertyIncome: MoneyTotals;
    /** Spent on the properties the party owns. */
    propertyExpenses: MoneyTotals;
    lines: ContactMoneyLine[];
  };
};

export type ContactUpdate = {
  displayName?: string | undefined;
  type?: 'person' | 'company' | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  status?: 'active' | 'inactive' | 'archived' | undefined;
  roles?: string[] | undefined;
  notes?: string | null | undefined;
  address?: ContactAddress | null | undefined;
};

export const OPEN_MAINTENANCE = new Set(['open', 'assigned', 'in_progress']);
export const CLOSED_LEGAL = new Set(['settled', 'closed', 'cancelled']);

export const MONEY_LINE_LABELS: Record<ContactMoneyLine['key'], { ar: string; en: string }> = {
  stay_payments: { ar: 'مدفوعات الإقامات', en: 'Stay payments' },
  reservation_deposits: { ar: 'عرابين الحجز', en: 'Booking deposits' },
  invoice_payments: { ar: 'سداد الفواتير', en: 'Invoice payments' },
  deposit_refunds: { ar: 'تأمينات مستردة له', en: 'Deposits refunded to them' },
  vendor_expenses: { ar: 'مصروفات مدفوعة له (مورّد)', en: 'Paid to them as supplier' },
  invoices_due: { ar: 'فواتير غير مسددة', en: 'Unpaid invoices' },
  property_stays: { ar: 'إيرادات الإقامات في عقاراته', en: 'Stay income on their properties' },
  property_deposits: { ar: 'عرابين الحجز في عقاراته', en: 'Booking deposits on their properties' },
  property_invoices: { ar: 'إيجارات محصّلة في عقاراته', en: 'Rent collected on their properties' },
  property_expenses: { ar: 'مصروفات عقاراته', en: 'Expenses on their properties' },
};
