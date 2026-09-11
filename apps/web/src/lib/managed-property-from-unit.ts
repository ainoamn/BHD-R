import type { CurrencyCode } from '@bhd-r/contracts';
import type { PublicUnitDetail } from '@bhd-r/contracts';
import type { ManagedProperty } from '@/components/property-detail-manager';
import { toPublicMediaSrc } from '@/lib/public-media-url';

/**
 * Lightweight Property 360 payload when the full showcase query times out.
 * Prefer this over notFound() so published units still render.
 */
export function managedPropertyFromPublicUnit(unit: PublicUnitDetail): ManagedProperty {
  const currency = (unit.rent?.currency ?? unit.salePrice?.currency ?? 'OMR') as CurrencyCode;
  const gallery = (unit.images ?? []).map((image, index) => ({
    id: image.id,
    url: toPublicMediaSrc(image.url) ?? image.url,
    position: index,
    unitId: unit.unitId,
    galleryScope: 'unit' as const,
  }));

  return {
    id: unit.propertyId,
    kind: 'multi_unit',
    category: unit.category,
    nameAr: unit.propertyNameAr,
    nameEn: unit.propertyNameEn,
    descriptionAr: unit.descriptionAr,
    descriptionEn: unit.descriptionEn,
    defaultCurrency: currency,
    status: 'active',
    serialNumber: unit.code ?? null,
    address: {
      countryCode: 'OM',
      governorate: unit.governorate,
      wilayat: unit.wilayat,
      city: unit.city,
      area: null,
      street: null,
    },
    gallery,
    amenities: [],
    documents: [],
    meters: [],
    ownership: [],
    units: [
      {
        id: unit.unitId,
        code: unit.code ?? '—',
        nameAr: unit.unitNameAr,
        nameEn: unit.unitNameEn,
        floor: null,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        majlis: 0,
        halls: 0,
        kitchens: 0,
        hasPool: false,
        areaSquareMeters: unit.areaSquareMeters != null ? String(unit.areaSquareMeters) : null,
        rentMinor: unit.rent.amountMinor,
        salePriceMinor: unit.salePrice?.amountMinor ?? null,
        depositMinor: unit.deposit?.amountMinor ?? null,
        currency,
        listingPurpose: unit.listingPurpose,
        publishWhenAvailable: true,
        listingEnabled: true,
        listingSlug: unit.slug,
        status: 'active',
        occupancy: 'available',
      },
    ],
  };
}
