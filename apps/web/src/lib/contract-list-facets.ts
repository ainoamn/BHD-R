import { contractPeriod, isIsoDate } from '@/lib/lease-terms';

export const CONTRACT_TERMS = ['daily', 'monthly', 'yearly', 'sale'] as const;
export type ContractTerm = (typeof CONTRACT_TERMS)[number];

export const PROPERTY_USAGES = ['residential', 'commercial', 'agricultural', 'industrial'] as const;
export type PropertyUsage = (typeof PROPERTY_USAGES)[number];

export const CONTRACT_VALIDITY = ['current', 'upcoming', 'ended'] as const;
export type ContractValidity = (typeof CONTRACT_VALIDITY)[number];

export const CONTRACT_TERM_LABELS: Record<ContractTerm, { ar: string; en: string }> = {
  daily: { ar: 'يومي', en: 'Daily' },
  monthly: { ar: 'شهري', en: 'Monthly' },
  yearly: { ar: 'سنوي', en: 'Yearly' },
  sale: { ar: 'بيع', en: 'Sale' },
};

export const PROPERTY_USAGE_LABELS: Record<PropertyUsage, { ar: string; en: string }> = {
  residential: { ar: 'سكني', en: 'Residential' },
  commercial: { ar: 'تجاري', en: 'Commercial' },
  agricultural: { ar: 'زراعي', en: 'Agricultural' },
  industrial: { ar: 'صناعي', en: 'Industrial' },
};

export const CONTRACT_VALIDITY_LABELS: Record<ContractValidity, { ar: string; en: string }> = {
  current: { ar: 'ساري', en: 'In force' },
  upcoming: { ar: 'لم يبدأ بعد', en: 'Upcoming' },
  ended: { ar: 'منتهٍ', en: 'Ended' },
};

const CATEGORY_USAGE: Record<string, PropertyUsage> = {
  apartment: 'residential',
  villa: 'residential',
  building: 'residential',
  office: 'commercial',
  shop: 'commercial',
  warehouse: 'industrial',
  land: 'agricultural',
};

/**
 * Daily for short stays, sale for sale contracts; leases are yearly from a full
 * year (12 months, or 11 months and most of the twelfth), otherwise monthly.
 */
export function contractTerm(input: {
  contractType: string | null;
  sourceType: string | null;
  stayType: string | null;
  startsOn: string | null;
  endsOn: string | null;
}): ContractTerm | null {
  if (input.contractType === 'sale') return 'sale';
  if (input.sourceType === 'stay_booking' || input.stayType) return 'daily';
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) return null;
  const { months, extraDays } = contractPeriod(input.startsOn, input.endsOn);
  return months >= 12 || (months === 11 && extraDays >= 25) ? 'yearly' : 'monthly';
}

/** The lease's declared use wins; otherwise it follows the property category. */
export function propertyUsage(input: {
  usageType: string | null;
  category: string | null;
}): PropertyUsage | null {
  if ((PROPERTY_USAGES as readonly string[]).includes(input.usageType ?? '')) {
    return input.usageType as PropertyUsage;
  }
  return CATEGORY_USAGE[input.category ?? ''] ?? null;
}

/** Where the term stands on `today` (YYYY-MM-DD, Muscat). */
export function contractValidity(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
  today: string,
): ContractValidity | null {
  if (!startsOn || !endsOn) return null;
  if (startsOn > today) return 'upcoming';
  if (endsOn < today) return 'ended';
  return 'current';
}

export function muscatToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Muscat',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
