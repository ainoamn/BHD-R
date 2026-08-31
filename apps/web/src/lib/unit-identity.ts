/** Infer multi-unit kind and derived serials (building serial + unit suffix). */

export type MultiUnitKind = 'apartment' | 'shop' | 'showroom';

export function inferUnitKind(unit: {
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}): MultiUnitKind {
  const blob = `${unit.code ?? ''} ${unit.nameAr ?? ''} ${unit.nameEn ?? ''}`.toLowerCase();
  if (/^s[-_]|\bshop\b|محل|محلات/.test(blob)) return 'shop';
  if (/^r[-_]|\bshowroom\b|معرض|معارض/.test(blob)) return 'showroom';
  if (/^a[-_]|\bapartment\b|شقة|شقق/.test(blob)) return 'apartment';
  return 'apartment';
}

export function unitKindLabel(kind: MultiUnitKind, locale: 'ar' | 'en'): string {
  if (kind === 'shop') return locale === 'ar' ? 'محل' : 'Shop';
  if (kind === 'showroom') return locale === 'ar' ? 'معرض' : 'Showroom';
  return locale === 'ar' ? 'شقة' : 'Apartment';
}

/** Map unit kind to browse category for catalogue cards. */
export function unitKindToCategory(kind: MultiUnitKind): 'apartment' | 'shop' | 'office' {
  if (kind === 'shop') return 'shop';
  if (kind === 'showroom') return 'office';
  return 'apartment';
}

/**
 * Unit serial derived from the building serial + type index (like bhd-om):
 * BHD-2026-PRP-I-0001-S1 / -M1 / -A1
 * Prefers digits from unit code (S-01 → S1) so catalogue pagination stays stable.
 */
export function getUnitSerialNumber(
  propertySerial: string | null | undefined,
  kind: MultiUnitKind,
  indexAmongKind: number,
  unitCode?: string | null,
): string | null {
  const base = propertySerial?.trim();
  if (!base) return null;
  const prefix = kind === 'shop' ? 'S' : kind === 'showroom' ? 'M' : 'A';
  const fromCode = unitCode?.match(/(\d+)/);
  const n = fromCode ? Number(fromCode[1]) : Math.max(0, indexAmongKind) + 1;
  if (!Number.isFinite(n) || n < 1) return `${base}-${prefix}${Math.max(0, indexAmongKind) + 1}`;
  return `${base}-${prefix}${n}`;
}

/** Assign serials for every unit under a property (stable by code digits within kind). */
export function assignUnitSerials(
  propertySerial: string | null | undefined,
  units: Array<{ id: string; code?: string | null; nameAr?: string | null; nameEn?: string | null }>,
): Map<string, string> {
  const counters: Record<MultiUnitKind, number> = { shop: 0, showroom: 0, apartment: 0 };
  const out = new Map<string, string>();
  for (const unit of units) {
    const kind = inferUnitKind(unit);
    const serial = getUnitSerialNumber(propertySerial, kind, counters[kind], unit.code);
    counters[kind] += 1;
    if (serial) out.set(unit.id, serial);
  }
  return out;
}

export function summarizeUnitKinds(
  units: Array<{ code?: string | null; nameAr?: string | null; nameEn?: string | null }>,
): { shop: number; showroom: number; apartment: number } {
  const counts = { shop: 0, showroom: 0, apartment: 0 };
  for (const unit of units) {
    counts[inferUnitKind(unit)] += 1;
  }
  return counts;
}
