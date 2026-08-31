import type { MultiUnitKind } from '@/lib/unit-identity';

export type GalleryScope = 'building' | 'unit';

export type GalleryItem = {
  id: string;
  url: string | null;
  position: number;
  unitId?: string;
  galleryScope?: GalleryScope | null;
};

/**
 * Building page: building-scoped photos only (legacy: first unit / anchor only).
 * Unit page: that unit's non-building photos; if empty, fall back to building photos.
 */
export function resolvePublicGallery(
  items: GalleryItem[],
  options: {
    focusUnitId?: string | null;
    propertyKind?: 'single_unit' | 'multi_unit';
    unitIdsOrdered?: string[];
  },
): GalleryItem[] {
  const ready = items
    .filter((item) => item.url)
    .sort((a, b) => a.position - b.position);
  if (!ready.length) return [];

  const anchorId = options.unitIdsOrdered?.[0] ?? ready[0]?.unitId ?? null;
  const buildingScoped = ready.filter((item) => item.galleryScope === 'building');
  const isMulti = options.propertyKind === 'multi_unit';

  if (options.focusUnitId) {
    const unitOwn = ready.filter(
      (item) =>
        item.unitId === options.focusUnitId && item.galleryScope !== 'building',
    );
    if (unitOwn.length) return unitOwn;
    if (buildingScoped.length) return buildingScoped;
    // Legacy shared copies: use anchor unit gallery as parent fallback.
    if (anchorId) return ready.filter((item) => item.unitId === anchorId);
    return ready;
  }

  if (!isMulti) return ready;

  if (buildingScoped.length) return buildingScoped;
  // Legacy multi-unit without scope: never mix sibling unit photos into the building.
  if (anchorId) return ready.filter((item) => item.unitId === anchorId);
  return ready;
}

export function unitKindPhrase(kind: MultiUnitKind, locale: 'ar' | 'en'): string {
  if (kind === 'shop') return locale === 'ar' ? 'محل' : 'shop';
  if (kind === 'showroom') return locale === 'ar' ? 'معرض' : 'showroom';
  return locale === 'ar' ? 'شقة' : 'apartment';
}
