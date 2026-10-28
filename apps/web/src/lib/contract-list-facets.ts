import { contractPeriod, isIsoDate } from '@/lib/lease-terms';

/** Group amendments under the original contract (owner + tenant lists). */
export function groupContractRowsByParent<
  T extends { id: string; parentContractId?: string | null; createdAt?: string | Date | null },
>(rows: T[]): Array<{ root: T; attachments: T[] }> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    const parentId = row.parentContractId ?? null;
    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? [];
      list.push(row);
      children.set(parentId, list);
    } else {
      roots.push(row);
    }
  }
  return roots.map((root) => ({
    root,
    attachments: (children.get(root.id) ?? [])
      .slice()
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
  }));
}

export function contractKindLabel(kind: string, ar: boolean): string {
  if (kind === 'renewal') return ar ? 'عقد تجديد' : 'Renewal contract';
  if (kind === 'amendment') return ar ? 'ملحق تعديل تواريخ' : 'Date-change addendum';
  if (kind === 'termination') return ar ? 'ملحق إلغاء' : 'Cancellation addendum';
  return ar ? 'عقد جديد' : 'New contract';
}

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

/**
 * Contract kinds still used for filtering / redirects.
 * Nav merge: daily + long_term → /leasing, sale → /sales, purchase stays under /contracts.
 */
export const CONTRACT_CATEGORIES = ['sale', 'purchase', 'daily', 'long_term'] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

/** Owner/developer ops hub after the leasing/sales/contracts nav merge. */
export function opsHubPathForContractCategory(
  category: ContractCategory | null | undefined,
): string {
  if (category === 'sale') return '/sales';
  if (category === 'daily' || category === 'long_term') return '/leasing';
  return '/contracts?kind=purchase';
}

export const CONTRACT_CATEGORY_LABELS: Record<
  ContractCategory,
  {
    ar: string;
    en: string;
    introAr: string;
    introEn: string;
    partyAr: string;
    partyEn: string;
  }
> = {
  sale: {
    ar: 'عقود البيع',
    en: 'Sale contracts',
    introAr: 'عقود بيع العقارات والوحدات للمشترين، مع التوقيع الإلكتروني وحالة كل عقد.',
    introEn: 'Contracts selling properties and units to buyers, with e-signatures and status.',
    partyAr: 'المشتري',
    partyEn: 'Buyer',
  },
  purchase: {
    ar: 'عقود الشراء',
    en: 'Purchase contracts',
    introAr: 'عقود شراء العقارات والوحدات من البائعين، مع التوقيع الإلكتروني وحالة كل عقد.',
    introEn: 'Contracts buying properties and units from sellers, with e-signatures and status.',
    partyAr: 'البائع',
    partyEn: 'Seller',
  },
  daily: {
    ar: 'عقود الإيجار اليومي',
    en: 'Daily rental contracts',
    introAr: 'عقود الإقامات القصيرة بالليلة، تصدر مع كل حجز يومي معتمد.',
    introEn: 'Short-stay contracts by the night, issued with every approved daily booking.',
    partyAr: 'الضيف',
    partyEn: 'Guest',
  },
  long_term: {
    ar: 'عقود الإيجار طويل الأجل',
    en: 'Long-term lease contracts',
    introAr: 'عقود الإيجار الشهري والسنوي، مع التوقيع الإلكتروني وحالة كل عقد.',
    introEn: 'Monthly and yearly lease contracts, with e-signatures and status.',
    partyAr: 'المستأجر',
    partyEn: 'Tenant',
  },
};

export function isContractCategory(value: unknown): value is ContractCategory {
  return (CONTRACT_CATEGORIES as readonly unknown[]).includes(value);
}

/** Purchase and sale by contract type; stays are daily; every other lease is long-term. */
export function contractCategory(input: {
  contractType: string | null;
  sourceType: string | null;
  stayType: string | null;
}): ContractCategory {
  if (input.contractType === 'purchase') return 'purchase';
  if (input.contractType === 'sale') return 'sale';
  if (input.sourceType === 'stay_booking' || input.stayType) return 'daily';
  return 'long_term';
}

/** Rows loaded without a category (older API) fall back to their term. */
export function rowContractCategory(category: unknown, term: unknown): ContractCategory {
  if (isContractCategory(category)) return category;
  if (term === 'sale') return 'sale';
  if (term === 'daily') return 'daily';
  return 'long_term';
}

export const CONTRACT_STATES = ['active', 'ended', 'cancelled', 'pending'] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const CONTRACT_STATE_LABELS: Record<ContractState, { ar: string; en: string }> = {
  active: { ar: 'ساري', en: 'In force' },
  ended: { ar: 'منتهي', en: 'Expired' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
  pending: { ar: 'معلق', en: 'Pending' },
};

/**
 * Cancelled / voided ops: guest cancelled, no-show, payment failed, or daily stay
 * checked out / closed (checkout issues a termination annex — owner sees ملغي).
 * Natural lease end stays in LINK_ENDED (منتهي).
 */
const LINK_CANCELLED = new Set([
  'cancelled',
  'expired',
  'payment_failed',
  'checked_out',
  'closed',
  'no_show',
  'terminated',
]);
const LINK_ENDED = new Set(['ended']);

/**
 * Void or terminated contracts and cancelled / checked-out stays are cancelled;
 * anything not fully signed is pending; signed contracts end with their lease
 * term or end date (Muscat), and are in force until then.
 */
export function contractState(input: {
  status: string | null | undefined;
  endsOn: string | null | undefined;
  linkedStatus: string | null | undefined;
  today: string;
}): ContractState {
  const linked = input.linkedStatus ?? '';
  if (input.status === 'void' || input.status === 'terminated') return 'cancelled';
  if (LINK_CANCELLED.has(linked)) return 'cancelled';
  if (input.status !== 'signed') return 'pending';
  if (LINK_ENDED.has(linked)) return 'ended';
  const endsOn = input.endsOn?.slice(0, 10);
  if (endsOn && endsOn < input.today) return 'ended';
  return 'active';
}

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
