/**
 * Amounts a landlord bills a tenant on top of the rent: utility bills, maintenance the tenant pays
 * for, damage, services and the like. Each is an invoice on the lease; its number's prefix keeps
 * the category. Client-safe.
 */

export const CHARGE_CATEGORIES = [
  'electricity',
  'water',
  'maintenance',
  'damage',
  'service',
  'other',
] as const;

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

const PREFIX: Record<ChargeCategory, string> = {
  electricity: 'ELC',
  water: 'WTR',
  maintenance: 'MNT',
  damage: 'DMG',
  service: 'SRV',
  other: 'CHG',
};

const CATEGORY_BY_PREFIX = new Map(
  Object.entries(PREFIX).map(([category, prefix]) => [prefix, category as ChargeCategory]),
);

export const CHARGE_LABEL: Record<ChargeCategory, { ar: string; en: string }> = {
  electricity: { ar: 'فاتورة كهرباء', en: 'Electricity bill' },
  water: { ar: 'فاتورة ماء', en: 'Water bill' },
  maintenance: { ar: 'تكلفة صيانة', en: 'Maintenance cost' },
  damage: { ar: 'تعويض تلف أو تخريب', en: 'Damage compensation' },
  service: { ar: 'رسوم خدمة', en: 'Service fee' },
  other: { ar: 'مطالبة أخرى', en: 'Other charge' },
};

export function chargeLabel(category: ChargeCategory, ar: boolean): string {
  return ar ? CHARGE_LABEL[category].ar : CHARGE_LABEL[category].en;
}

/** The category of a charge invoice, or null for rent and other invoices. */
export function chargeCategoryOf(invoiceNumber: string): ChargeCategory | null {
  const match = /^([A-Z]{3})-/.exec(invoiceNumber);
  return (match && CATEGORY_BY_PREFIX.get(match[1]!)) ?? null;
}

/** A fresh invoice number for a charge, unique enough per organization: `MNT-261014-4F7A2C`. */
export function chargeInvoiceNumber(
  category: ChargeCategory,
  today: string,
  random: string,
): string {
  const day = today.replace(/-/g, '').slice(2, 8);
  return `${PREFIX[category]}-${day}-${random
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase()}`;
}

/** How the tenant pays for maintenance the landlord accepted at their cost. */
export type ChargePayment = 'before_work' | 'deferred';
