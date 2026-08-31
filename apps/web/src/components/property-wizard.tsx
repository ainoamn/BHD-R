'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, Field, SelectField, TextAreaField } from '@bhd-r/ui';
import { supportedCurrencyCodes, currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { countryPacks, type CountryPackCode } from '@bhd-r/country-packs';
import { useLocale, useTranslations } from 'next-intl';
import { browserMutation, clearBrowserCsrfCache, fetchBrowserCsrfToken, mapWithConcurrency } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { toMinorUnits } from '@/lib/format';
import { omanLocations } from '@/lib/oman-locations';
import {
  generateListingDescriptions,
  translateText,
} from '@/lib/property-listing-copy';
import {
  googleMapsEmbedSrc,
  googleMapsLinkFromCoords,
  parseGoogleMapsUrl,
} from '@/lib/parse-google-maps-url';
import { MapLocationPicker } from '@/components/map-location-picker';
import { NestReconnectButton } from '@/components/nest-reconnect-button';
import type { ManagedProperty } from '@/components/property-detail-manager';
import type { OwnerPartyOption } from '@/lib/owner-parties';

function majorFromMinor(minor: string | null | undefined, currency: CurrencyCode): string {
  if (!minor) return '';
  const places = currencyMinorUnits[currency];
  const digits = minor.padStart(places + 1, '0');
  if (places === 0) return digits;
  const whole = digits.slice(0, -places);
  const frac = digits.slice(-places).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function goToPropertyPage(locale: string, portal: string, id: string) {
  // Hard navigation — next/navigation soft push can leave the wizard on /edit after save.
  window.location.assign(`/${locale}/${portal}/properties/${encodeURIComponent(id)}`);
}

type MediaItem = { id: string; file?: File; url: string; existing?: boolean };

interface UnitDraft {
  localId: string;
  unitKind: 'apartment' | 'shop' | 'showroom';
  code: string;
  nameAr: string;
  nameEn: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
  majlis: string;
  halls: string;
  kitchens: string;
  hasPool: string;
  area: string;
  listingPurpose: 'rent' | 'sale' | 'both';
  rent: string;
  salePrice: string;
  deposit: string;
  publishWhenAvailable: boolean;
  images: MediaItem[];
}

type MultiUnitKind = UnitDraft['unitKind'];

function inferUnitKind(unit: {
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}): MultiUnitKind {
  const blob = `${unit.code ?? ''} ${unit.nameAr ?? ''} ${unit.nameEn ?? ''}`.toLowerCase();
  if (/shop|محل|محلات/.test(blob)) return 'shop';
  if (/showroom|معرض|معارض/.test(blob)) return 'showroom';
  return 'apartment';
}

const blankUnit = (index: number, unitKind: MultiUnitKind = 'apartment'): UnitDraft => ({
  localId: crypto.randomUUID(),
  unitKind,
  code: unitKind === 'apartment' ? `A-${String(index).padStart(2, '0')}` : unitKind === 'shop' ? `S-${String(index).padStart(2, '0')}` : `R-${String(index).padStart(2, '0')}`,
  nameAr: '',
  nameEn: '',
  floor: unitKind === 'apartment' ? '' : '0',
  bedrooms: unitKind === 'apartment' ? '' : '0',
  bathrooms: unitKind === 'apartment' ? '' : '0',
  majlis: unitKind === 'apartment' ? '' : '0',
  halls: unitKind === 'apartment' ? '' : '0',
  kitchens: unitKind === 'apartment' ? '' : '0',
  hasPool: unitKind === 'apartment' ? '' : 'false',
  area: '',
  listingPurpose: 'rent',
  rent: '',
  salePrice: '',
  deposit: '',
  publishWhenAvailable: false,
  images: [],
});

function syncMultiUnitsFromCounts(
  counts: { shop: number; showroom: number; apartment: number },
  previous: UnitDraft[],
): UnitDraft[] {
  const take = (kind: MultiUnitKind, n: number) => {
    const existing = previous.filter((unit) => unit.unitKind === kind);
    const next: UnitDraft[] = [];
    for (let i = 0; i < n; i += 1) {
      next.push(existing[i] ?? blankUnit(i + 1, kind));
    }
    return next;
  };
  return [
    ...take('shop', Math.max(0, counts.shop)),
    ...take('showroom', Math.max(0, counts.showroom)),
    ...take('apartment', Math.max(0, counts.apartment)),
  ];
}

interface CreatedPropertyBundle {
  id: string;
  serialNumber?: string;
  units: Array<{ id: string }>;
}

type PrivateDocType = 'title_deed' | 'floor_plan' | 'other';
type DocItem = {
  id: string;
  file?: File;
  url: string;
  kind: 'pdf' | 'image';
  documentType: PrivateDocType;
  existing?: boolean;
  label?: string;
};

function extractMapsUrl(notes?: string | null, fallback?: string | null): string {
  if (fallback?.trim()) return fallback.trim();
  if (!notes) return '';
  const match = notes.match(/Google Maps:\s*(https?:\/\/\S+)/i);
  return match?.[1]?.replace(/[.,;]+$/, '') ?? '';
}

function stripMapsFromNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes
    .replace(/Google Maps:\s*https?:\/\/\S+/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function revokeIfBlob(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

const BEDROOM_OPTIONS = Array.from({ length: 16 }, (_, i) => String(i)); // 0–15
const BATHROOM_OPTIONS = Array.from({ length: 11 }, (_, i) => String(i)); // 0–10
const ROOM_COUNT_OPTIONS = Array.from({ length: 11 }, (_, i) => String(i)); // 0–10
const FLOOR_OPTIONS = Array.from({ length: 51 }, (_, i) => String(i)); // 0–50

const BASE_AMENITIES = [
  ['parking', 'مواقف', 'Parking', '🅿'],
  ['elevator', 'مصعد', 'Elevator', '🛗'],
  ['security', 'حراسة', 'Security', '🛡'],
  ['cctv', 'كاميرات مراقبة', 'CCTV', '📹'],
  ['pool', 'مسبح', 'Pool', '🏊'],
  ['gym', 'نادي صحي', 'Gym', '🏋'],
  ['garden', 'حديقة', 'Garden', '🌳'],
  ['central_ac', 'تكييف مركزي', 'Central AC', '❄'],
  ['accessible', 'مهيأ لذوي الإعاقة', 'Accessible', '♿'],
  ['fire_system', 'نظام حريق', 'Fire system', '🔥'],
  ['balcony', 'شرفة', 'Balcony', '🏙'],
  ['maid_room', 'غرفة خادمة', 'Maid room', '🚪'],
  ['storage', 'مخزن', 'Storage', '📦'],
  ['laundry', 'غسيل ملابس', 'Laundry', '🧺'],
  ['wifi', 'إنترنت', 'Wi‑Fi', '📶'],
  ['kids_area', 'منطقة أطفال', 'Kids area', '🧒'],
  ['mosque_nearby', 'قرب المسجد', 'Nearby mosque', '🕌'],
  ['school_nearby', 'قرب المدارس', 'Nearby schools', '🏫'],
  ['sea_view', 'إطلالة بحرية', 'Sea view', '🌊'],
  ['mountain_view', 'إطلالة جبلية', 'Mountain view', '⛰'],
  ['furnished_kit', 'مطبخ مجهّز', 'Equipped kitchen', '🍳'],
  ['smart_home', 'منزل ذكي', 'Smart home', '🏠'],
] as const;

function tone(value: string, required: boolean, _showErrors: boolean): 'ok' | 'missing' | 'neutral' {
  if (!required) return value.trim() ? 'ok' : 'neutral';
  return value.trim() ? 'ok' : 'missing';
}

export function PropertyWizard({
  ownerPartyId,
  ownerPartyOptions = [],
  portal,
  mode = 'create',
  propertyId,
  initialProperty,
}: {
  ownerPartyId: string;
  ownerPartyOptions?: OwnerPartyOption[];
  portal: 'owner' | 'developer';
  mode?: 'create' | 'edit';
  propertyId?: string;
  initialProperty?: ManagedProperty;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const ar = locale === 'ar';
  const [selectedOwnerPartyId, setSelectedOwnerPartyId] = useState(ownerPartyId);
  const [step, setStep] = useState(0);
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');
  const [maxReached, setMaxReached] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [missingHints, setMissingHints] = useState<string[]>([]);
  const [kind, setKind] = useState<'single_unit' | 'multi_unit'>(
    initialProperty?.kind ?? 'single_unit',
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    initialProperty?.defaultCurrency ?? 'OMR',
  );
  const [property, setProperty] = useState(() => {
    const mapsUrl = extractMapsUrl(initialProperty?.profile?.notes, initialProperty?.mapsUrl);
    const coords =
      typeof initialProperty?.latitude === 'number' &&
      typeof initialProperty?.longitude === 'number'
        ? { latitude: initialProperty.latitude, longitude: initialProperty.longitude }
        : parseGoogleMapsUrl(mapsUrl);
    return {
      countryCode: (initialProperty?.address?.countryCode as CountryPackCode) || 'OM',
      category: initialProperty?.category ?? 'apartment',
      nameAr: initialProperty?.nameAr ?? '',
      nameEn: initialProperty?.nameEn ?? '',
      descriptionAr: initialProperty?.descriptionAr ?? '',
      descriptionEn: initialProperty?.descriptionEn ?? '',
      governorate: initialProperty?.address?.governorate ?? '',
      wilayat: initialProperty?.address?.wilayat ?? '',
      city: initialProperty?.address?.city ?? '',
      area: initialProperty?.address?.area ?? '',
      street: initialProperty?.address?.street ?? '',
      mapsUrl,
      latitude: coords ? String(coords.latitude) : '',
      longitude: coords ? String(coords.longitude) : '',
    };
  });
  const [units, setUnits] = useState<UnitDraft[]>(() => {
    if (initialProperty?.units?.length) {
      const gallery = initialProperty.gallery ?? [];
      return initialProperty.units.map((unit, index) => {
        const unitKind =
          initialProperty.kind === 'multi_unit' ? inferUnitKind(unit) : ('apartment' as const);
        const unitImages = gallery
          .filter((item) => item.unitId === unit.id && item.url)
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            id: item.id,
            url: item.url!,
            existing: true,
          }));
        return {
          localId: unit.id,
          unitKind,
          code: unit.code || `U-${String(index + 1).padStart(2, '0')}`,
          nameAr: unit.nameAr,
          nameEn: unit.nameEn,
          floor: unit.floor ?? (unitKind === 'apartment' ? '' : '0'),
          bedrooms: String(unit.bedrooms),
          bathrooms: String(unit.bathrooms),
          majlis: String(unit.majlis ?? 0),
          halls: String(unit.halls ?? 0),
          kitchens: String(unit.kitchens ?? 0),
          hasPool: unit.hasPool ? 'true' : 'false',
          area: unit.areaSquareMeters ?? '',
          listingPurpose: unit.listingPurpose,
          rent: majorFromMinor(unit.rentMinor, unit.currency),
          salePrice: majorFromMinor(unit.salePriceMinor, unit.currency),
          deposit: majorFromMinor(unit.depositMinor, unit.currency),
          publishWhenAvailable: unit.publishWhenAvailable,
          images: unitImages,
        };
      });
    }
    return [blankUnit(1)];
  });
  const [multiMediaMode, setMultiMediaMode] = useState<'building' | 'per_unit'>(() => {
    if (initialProperty?.kind !== 'multi_unit') return 'building';
    const gallery = initialProperty.gallery ?? [];
    const unitIds = new Set((initialProperty.units ?? []).map((unit) => unit.id));
    const perUnit = gallery.some((item) => item.unitId && unitIds.has(item.unitId));
    // If images exist on more than one unit with different asset sets, prefer per_unit.
    const byUnit = new Map<string, number>();
    for (const item of gallery) {
      if (!item.unitId) continue;
      byUnit.set(item.unitId, (byUnit.get(item.unitId) ?? 0) + 1);
    }
    return byUnit.size > 1 ? 'per_unit' : perUnit && byUnit.size === 1 ? 'building' : 'building';
  });
  const [unitCountShop, setUnitCountShop] = useState(() =>
    initialProperty?.kind === 'multi_unit'
      ? String(
          (initialProperty.units ?? []).filter((unit) => inferUnitKind(unit) === 'shop').length ||
            '',
        )
      : '',
  );
  const [unitCountShowroom, setUnitCountShowroom] = useState(() =>
    initialProperty?.kind === 'multi_unit'
      ? String(
          (initialProperty.units ?? []).filter((unit) => inferUnitKind(unit) === 'showroom')
            .length || '',
        )
      : '',
  );
  const [unitCountApartment, setUnitCountApartment] = useState(() =>
    initialProperty?.kind === 'multi_unit'
      ? String(
          (initialProperty.units ?? []).filter((unit) => inferUnitKind(unit) === 'apartment')
            .length || '',
        )
      : '',
  );
  const [profile, setProfile] = useState(() => {
    const p = initialProperty?.profile;
    const electricity =
      initialProperty?.meters.find((m) => m.utilityType === 'electricity')?.meterNumber ?? '';
    const water =
      initialProperty?.meters.find((m) => m.utilityType === 'water')?.meterNumber ?? '';
    const insurance = initialProperty?.documents.find((d) => d.documentType === 'insurance');
    return {
      deedNumber: p?.deedNumber ?? '',
      plotNumber: p?.plotNumber ?? '',
      municipalityNumber: p?.municipalityNumber ?? '',
      landArea: p?.landAreaSquareMeters ?? '',
      builtUpArea: p?.builtUpAreaSquareMeters ?? '',
      yearBuilt: p?.yearBuilt != null ? String(p.yearBuilt) : '',
      parkingSpaces: p?.parkingSpaces != null ? String(p.parkingSpaces) : '',
      furnishing: (p?.furnishing ?? 'unfurnished') as
        | 'unfurnished'
        | 'semi_furnished'
        | 'furnished',
      managementStartedOn: p?.managementStartedOn ?? '',
      managementFee: majorFromMinor(
        p?.managementFeeMinor,
        initialProperty?.defaultCurrency ?? 'OMR',
      ),
      electricityMeter: electricity,
      waterMeter: water,
      insuranceNumber: insurance?.documentNumber ?? '',
      insuranceExpiresOn: insurance?.expiresOn ?? '',
      notes: stripMapsFromNotes(p?.notes),
    };
  });
  const [amenities, setAmenities] = useState<string[]>(
    () => initialProperty?.amenities.map((item) => item.code) ?? [],
  );
  const [customAmenities, setCustomAmenities] = useState<
    Array<{ code: string; labelAr: string; labelEn: string }>
  >(() => {
    const base = new Set(BASE_AMENITIES.map(([code]) => code as string));
    return (initialProperty?.amenities ?? [])
      .filter((item) => !base.has(item.code))
      .map((item) => ({
        code: item.code,
        labelAr: item.labelAr || item.code,
        labelEn: item.labelEn || item.code,
      }));
  });
  const [customDraft, setCustomDraft] = useState({ ar: '', en: '' });
  const [images, setImages] = useState<MediaItem[]>(() => {
    const gallery = (initialProperty?.gallery ?? [])
      .filter((item) => item.url)
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        url: item.url!,
        existing: true,
      }));
    return gallery;
  });
  const [coverId, setCoverId] = useState<string | null>(
    () => (initialProperty?.gallery ?? []).find((item) => item.url)?.id ?? null,
  );
  const [documents, setDocuments] = useState<DocItem[]>(() => {
    const privateTypes = new Set<PrivateDocType>(['title_deed', 'floor_plan', 'other']);
    return (initialProperty?.documents ?? [])
      .filter((doc) => privateTypes.has(doc.documentType as PrivateDocType))
      .map((doc) => ({
        id: doc.id,
        url: '',
        kind: 'pdf' as const,
        documentType: doc.documentType as PrivateDocType,
        existing: true,
        label: doc.documentNumber || doc.documentType,
      }));
  });
  const [busy, setBusy] = useState(false);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const bundleIdempotencyKey = useRef(`property-bundle:${crypto.randomUUID()}`);

  const steps = [
    t('PropertyForm.basics'),
    t('PropertyForm.units'),
    t('PropertyForm.operationsAmenities'),
    t('PropertyForm.ownershipDocuments'),
    t('PropertyForm.media'),
    t('PropertyForm.descriptionReview'),
    t('PropertyForm.listingPreview'),
  ];

  const amenityOptions = useMemo(
    () => [
      ...BASE_AMENITIES,
      ...customAmenities.map(
        (c) => [c.code, c.labelAr, c.labelEn, '✦'] as const,
      ),
    ],
    [customAmenities],
  );
  const [translating, setTranslating] = useState<'name-en' | 'name-ar' | 'desc-en' | 'desc-ar' | null>(
    null,
  );

  useEffect(() => {
    // Warm Nest process only — do NOT mint Nest CSRF here (overwrites bhd_r_csrf
    // and races with Next CSRF used by translate / owner media / reviews).
    void fetch('/api/warm', { cache: 'no-store' }).catch(() => undefined);
  }, []);

  async function translateField(
    source: string,
    target: 'ar' | 'en',
    apply: (value: string) => void,
    key: 'name-en' | 'name-ar' | 'desc-en' | 'desc-ar',
  ) {
    if (!source.trim()) return;
    setTranslating(key);
    setError(null);
    try {
      const translated = await translateText(source, target);
      apply(translated);
    } catch {
      setError(
        ar
          ? 'تعذّرت الترجمة التلقائية حالياً. عدّل النص يدوياً أو أعد المحاولة بعد لحظات.'
          : 'Automatic translation is unavailable right now. Edit manually or retry shortly.',
      );
    } finally {
      setTranslating(null);
    }
  }

  const selectedGov = omanLocations.find(
    (g) => g.ar === property.governorate || g.en === property.governorate,
  );
  const selectedWilayat = selectedGov?.states.find(
    (s) => s.ar === property.wilayat || s.en === property.wilayat,
  );

  useEffect(() => {
    return () => {
      images.forEach((item) => revokeIfBlob(item.url));
      documents.forEach((item) => revokeIfBlob(item.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke on unmount only
  }, []);

  function updateUnit(id: string, field: keyof UnitDraft, value: string | boolean) {
    setUnits((current) =>
      current.map((unit) => (unit.localId === id ? { ...unit, [field]: value } : unit)),
    );
  }

  /** Copy filled fields from this unit onto later siblings of the same kind (keep each unit number). */
  function cloneUnitDetailsToSameKind(sourceId: string) {
    setUnits((current) => {
      const source = current.find((unit) => unit.localId === sourceId);
      if (!source) return current;
      let seenSource = false;
      return current.map((unit) => {
        if (unit.localId === sourceId) {
          seenSource = true;
          return unit;
        }
        if (!seenSource || unit.unitKind !== source.unitKind) return unit;
        return {
          ...unit,
          floor: source.floor,
          bedrooms: source.bedrooms,
          bathrooms: source.bathrooms,
          majlis: source.majlis,
          halls: source.halls,
          kitchens: source.kitchens,
          hasPool: source.hasPool,
          area: source.area,
          listingPurpose: source.listingPurpose,
          rent: source.rent,
          salePrice: source.salePrice,
          deposit: source.deposit,
          publishWhenAvailable: source.publishWhenAvailable,
          // Keep each unit's own photos — cloning prices/specs does not copy images.
        };
      });
    });
  }

  function updateProperty(field: keyof typeof property, value: string) {
    setProperty((current) => ({ ...current, [field]: value }));
  }

  function focusNextField(from?: HTMLElement | null) {
    if (typeof window === 'undefined') return;
    const root = document.querySelector('.wizard-shell .card__content');
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null);
    const active = from ?? (document.activeElement as HTMLElement | null);
    const index = active ? focusables.indexOf(active) : -1;
    const next = focusables[index + 1];
    if (next) {
      window.setTimeout(() => next.focus(), 40);
      return;
    }
    // Last field of this step filled — advance when valid.
    window.setTimeout(() => {
      if (step >= steps.length - 1) return;
      if (validateStep(step).length === 0) goToStep(step + 1);
    }, 120);
  }

  function onSelectAdvance(
    event: ChangeEvent<HTMLSelectElement>,
    apply: (value: string) => void,
  ) {
    apply(event.target.value);
    focusNextField(event.currentTarget);
  }

  function applyMapsUrl(value: string) {
    const coords = parseGoogleMapsUrl(value);
    setProperty((current) => ({
      ...current,
      mapsUrl: value,
      latitude: coords ? String(coords.latitude) : '',
      longitude: coords ? String(coords.longitude) : '',
    }));
  }

  function applyMapsCoords(latitude: number, longitude: number, mapsUrl?: string) {
    setProperty((current) => ({
      ...current,
      mapsUrl: mapsUrl ?? googleMapsLinkFromCoords(latitude, longitude),
      latitude: String(latitude),
      longitude: String(longitude),
    }));
  }

  function unitDisplayNames(unit: UnitDraft): { nameAr: string; nameEn: string } {
    if (kind === 'single_unit') {
      return { nameAr: property.nameAr.trim(), nameEn: property.nameEn.trim() };
    }
    const code = unit.code.trim() || 'U';
    const typeAr =
      unit.unitKind === 'shop' ? 'محل' : unit.unitKind === 'showroom' ? 'معرض' : 'شقة';
    const typeEn =
      unit.unitKind === 'shop' ? 'Shop' : unit.unitKind === 'showroom' ? 'Showroom' : 'Apartment';
    return {
      nameAr: `${property.nameAr.trim()} — ${typeAr} ${code}`,
      nameEn: `${property.nameEn.trim()} — ${typeEn} ${code}`,
    };
  }

  function applyMultiUnitCounts(next: {
    shop?: string;
    showroom?: string;
    apartment?: string;
  }) {
    const shop = next.shop !== undefined ? next.shop : unitCountShop;
    const showroom = next.showroom !== undefined ? next.showroom : unitCountShowroom;
    const apartment = next.apartment !== undefined ? next.apartment : unitCountApartment;
    if (next.shop !== undefined) setUnitCountShop(shop);
    if (next.showroom !== undefined) setUnitCountShowroom(showroom);
    if (next.apartment !== undefined) setUnitCountApartment(apartment);
    setUnits((current) =>
      syncMultiUnitsFromCounts(
        {
          shop: Math.max(0, Number(shop) || 0),
          showroom: Math.max(0, Number(showroom) || 0),
          apartment: Math.max(0, Number(apartment) || 0),
        },
        current,
      ),
    );
  }

  function updateProfile(field: keyof typeof profile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function validateStep(index: number): string[] {
    const issues: string[] = [];
    if (index === 0) {
      if (property.nameAr.trim().length < 2) issues.push(ar ? 'الاسم بالعربية' : 'Arabic name');
      if (property.nameEn.trim().length < 2) issues.push(ar ? 'الاسم بالإنجليزية' : 'English name');
      if (!property.category) issues.push(t('PropertyForm.category'));
      if (property.countryCode === 'OM') {
        if (!property.governorate) issues.push(t('PropertyForm.governorate'));
        if (!property.wilayat) issues.push(t('PropertyForm.wilayat'));
        if (!property.city) issues.push(t('PropertyForm.village'));
      } else {
        if (!property.governorate) issues.push(t('PropertyForm.governorate'));
        if (!property.wilayat) issues.push(t('PropertyForm.wilayat'));
        if (!property.city) issues.push(t('PropertyForm.city'));
      }
      if (!property.mapsUrl.trim()) issues.push(t('PropertyForm.mapsUrl'));
      else if (!parseGoogleMapsUrl(property.mapsUrl)) issues.push(t('PropertyForm.mapsUrlInvalid'));
      if (kind === 'multi_unit') {
        const total =
          (Number(unitCountShop) || 0) +
          (Number(unitCountShowroom) || 0) +
          (Number(unitCountApartment) || 0);
        if (total < 1) issues.push(t('PropertyForm.unitCountsRequired'));
      }
    }
    if (index === 1) {
      if (kind === 'multi_unit') {
        if (!profile.builtUpArea.trim() || !(Number(profile.builtUpArea) > 0)) {
          issues.push(t('PropertyForm.multiUnitTotalArea'));
        }
        units.forEach((unit, i) => {
          const typeLabel =
            unit.unitKind === 'shop'
              ? t('PropertyForm.unitKindShop')
              : unit.unitKind === 'showroom'
                ? t('PropertyForm.unitKindShowroom')
                : t('PropertyForm.unitKindApartment');
          const label = `${typeLabel} ${i + 1}`;
          if (!unit.code.trim()) issues.push(`${label}: ${t('PropertyForm.unitNumber')}`);
          if (!unit.area.trim() || !(Number(unit.area) > 0))
            issues.push(`${label}: ${t('PropertyForm.area')}`);
          if (unit.listingPurpose !== 'sale' && !unit.rent.trim())
            issues.push(`${label}: ${t('PropertyForm.rent')}`);
          if (unit.listingPurpose !== 'rent' && !unit.salePrice.trim())
            issues.push(`${label}: ${t('PropertyForm.salePrice')}`);
          if (unit.unitKind === 'apartment') {
            if (unit.bedrooms === '') issues.push(`${label}: ${t('PropertyForm.bedrooms')}`);
            if (unit.bathrooms === '') issues.push(`${label}: ${t('PropertyForm.bathrooms')}`);
            if (unit.majlis === '') issues.push(`${label}: ${t('PropertyForm.majlis')}`);
            if (unit.halls === '') issues.push(`${label}: ${t('PropertyForm.halls')}`);
          }
        });
      } else {
        units.forEach((unit, i) => {
          const label = `${t('PropertyForm.unit')} ${i + 1}`;
          if (!unit.floor.trim()) issues.push(`${label}: ${t('PropertyForm.floor')}`);
          if (unit.bedrooms === '') issues.push(`${label}: ${t('PropertyForm.bedrooms')}`);
          if (unit.bathrooms === '') issues.push(`${label}: ${t('PropertyForm.bathrooms')}`);
          if (unit.majlis === '') issues.push(`${label}: ${t('PropertyForm.majlis')}`);
          if (unit.halls === '') issues.push(`${label}: ${t('PropertyForm.halls')}`);
          if (unit.kitchens === '') issues.push(`${label}: ${t('PropertyForm.kitchens')}`);
          if (unit.hasPool === '') issues.push(`${label}: ${t('PropertyForm.hasPool')}`);
          if (unit.listingPurpose !== 'sale' && !unit.rent.trim())
            issues.push(`${label}: ${t('PropertyForm.rent')}`);
          if (unit.listingPurpose !== 'rent' && !unit.salePrice.trim())
            issues.push(`${label}: ${t('PropertyForm.salePrice')}`);
        });
      }
    }
    if (index === 4) {
      // Images are optional so save can proceed when media upload is degraded.
      const bad = images.some((item) => {
        if (item.existing || !item.file) return false;
        return (
          !['image/jpeg', 'image/png', 'image/webp'].includes(item.file.type) ||
          item.file.size > 10 * 1024 * 1024
        );
      });
      if (images.some((item) => item.file) && bad) issues.push(t('PropertyForm.imageHelp'));
    }
    return issues;
  }

  function goToStep(next: number) {
    if (next > step) {
      const issues = validateStep(step);
      if (issues.length) {
        setShowErrors(true);
        setMissingHints(issues);
        setError(
          ar
            ? `أكمل الحقول المطلوبة قبل المتابعة: ${issues.slice(0, 4).join('، ')}`
            : `Complete required fields before continuing: ${issues.slice(0, 4).join(', ')}`,
        );
        return;
      }
      setShowErrors(false);
      setMissingHints([]);
      setError(null);
      setMaxReached((m) => Math.max(m, next));
      setSlideDir('forward');
      setStep(next);
      return;
    }
    if (next < step && next >= 0) {
      setShowErrors(false);
      setMissingHints([]);
      setError(null);
      setSlideDir('back');
      setStep(next);
    }
  }

  function appendImageFiles(
    files: File[],
    apply: (items: MediaItem[]) => void,
    maxTotal: number,
    currentCount: number,
  ) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);
    const accepted: MediaItem[] = [];
    let rejectedHeic = false;
    let rejectedOther = false;
    for (const file of files) {
      const type = (file.type || '').toLowerCase();
      const name = file.name.toLowerCase();
      if (
        type === 'image/heic' ||
        type === 'image/heif' ||
        name.endsWith('.heic') ||
        name.endsWith('.heif')
      ) {
        rejectedHeic = true;
        continue;
      }
      const normalized =
        type === 'image/jpg' ? 'image/jpeg' : type || (name.endsWith('.png') ? 'image/png' : '');
      if (!allowed.has(normalized) && !allowed.has(type)) {
        rejectedOther = true;
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        rejectedOther = true;
        continue;
      }
      const blobType = normalized === 'image/jpg' ? 'image/jpeg' : normalized || file.type;
      const normalizedFile =
        blobType && blobType !== file.type
          ? new File([file], file.name, { type: blobType, lastModified: file.lastModified })
          : file;
      accepted.push({
        id: crypto.randomUUID(),
        file: normalizedFile,
        url: URL.createObjectURL(normalizedFile),
      });
    }
    if (!accepted.length) {
      setError(rejectedHeic ? t('PropertyForm.imageHeicHelp') : t('PropertyForm.imageHelp'));
      return;
    }
    const room = Math.max(0, maxTotal - currentCount);
    if (room === 0) {
      accepted.forEach((item) => revokeIfBlob(item.url));
      setError(t('PropertyForm.imagesMaxReached'));
      return;
    }
    const toAdd = accepted.slice(0, room);
    accepted.slice(room).forEach((item) => revokeIfBlob(item.url));
    apply(toAdd);
    setShowErrors(false);
    setMissingHints([]);
    setError(
      rejectedHeic
        ? t('PropertyForm.imageHeicHelp')
        : rejectedOther
          ? t('PropertyForm.imageHelp')
          : null,
    );
    void (async () => {
      for (const item of toAdd) {
        if (!item.file) continue;
        const compressed = await compressImageFile(item.file);
        if (compressed === item.file) continue;
        const nextUrl = URL.createObjectURL(compressed);
        setImages((current) =>
          current.map((row) => {
            if (row.id !== item.id) return row;
            revokeIfBlob(row.url);
            return { ...row, file: compressed, url: nextUrl };
          }),
        );
        setUnits((current) =>
          current.map((unit) => ({
            ...unit,
            images: unit.images.map((row) => {
              if (row.id !== item.id) return row;
              revokeIfBlob(row.url);
              return { ...row, file: compressed, url: nextUrl };
            }),
          })),
        );
      }
    })();
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    appendImageFiles(
      files,
      (toAdd) => {
        setImages((current) => [...current, ...toAdd]);
        setCoverId((current) => current ?? toAdd[0]?.id ?? null);
      },
      12,
      images.length,
    );
  }

  function selectUnitImages(unitLocalId: string, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    const unit = units.find((item) => item.localId === unitLocalId);
    appendImageFiles(
      files,
      (toAdd) => {
        setUnits((current) =>
          current.map((item) =>
            item.localId === unitLocalId
              ? { ...item, images: [...item.images, ...toAdd] }
              : item,
          ),
        );
      },
      8,
      unit?.images.length ?? 0,
    );
  }

  async function removeImage(id: string) {
    const target =
      images.find((item) => item.id === id) ??
      units.flatMap((unit) => unit.images).find((item) => item.id === id);
    if (!target || removingIds.has(id)) return;

    // Existing gallery assets must be deleted on the server — local-only remove
    // was why images kept coming back after refresh / re-open edit.
    if (target.existing) {
      setRemovingIds((current) => new Set(current).add(id));
      setError(null);
      try {
        const response = await fetch(`/api/owner/media/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'x-csrf-token': await fetchBrowserCsrfToken(),
          },
        });
        if (!response.ok && response.status !== 404) {
          const body = (await response.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          throw new Error(body?.error?.message ?? body?.error?.code ?? `delete_failed:${response.status}`);
        }
      } catch (deleteError) {
        setError(
          ar
            ? `تعذّر حذف الصورة: ${deleteError instanceof Error ? deleteError.message : 'خطأ غير معروف'}`
            : `Could not remove image: ${deleteError instanceof Error ? deleteError.message : 'unknown error'}`,
        );
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        return;
      }
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }

    setImages((current) => {
      const row = current.find((item) => item.id === id);
      if (row) revokeIfBlob(row.url);
      const next = current.filter((item) => item.id !== id);
      setCoverId((cover) => {
        if (cover && next.some((item) => item.id === cover)) return cover;
        return next[0]?.id ?? null;
      });
      return next;
    });
    setUnits((current) =>
      current.map((unit) => {
        const row = unit.images.find((item) => item.id === id);
        if (row) revokeIfBlob(row.url);
        return { ...unit, images: unit.images.filter((item) => item.id !== id) };
      }),
    );
    setPreviewId((current) => (current === id ? null : current));
  }

  function selectDocuments(documentType: PrivateDocType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type) || file.size > 25 * 1024 * 1024) {
      setError(t('PropertyForm.documentHelp'));
      return;
    }
    const next: DocItem = {
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      kind: file.type.includes('pdf') ? 'pdf' : 'image',
      documentType,
    };
    setDocuments((current) => {
      const previous = current.find((item) => item.documentType === documentType);
      if (previous) revokeIfBlob(previous.url);
      return [...current.filter((item) => item.documentType !== documentType), next];
    });
  }

  function removeDocument(documentType: PrivateDocType) {
    setDocuments((current) => {
      const previous = current.find((item) => item.documentType === documentType);
      if (previous) revokeIfBlob(previous.url);
      return current.filter((item) => item.documentType !== documentType);
    });
  }

  function addCustomAmenity() {
    const labelAr = customDraft.ar.trim();
    const labelEn = customDraft.en.trim() || labelAr;
    if (!labelAr) return;
    const code = `custom_${labelEn.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
    setCustomAmenities((current) => [...current, { code, labelAr, labelEn }]);
    setAmenities((current) => (current.includes(code) ? current : [...current, code]));
    setCustomDraft({ ar: '', en: '' });
  }

  function runAiDescription() {
    const primary = units[0]!;
    const amenityPayload = amenities.map((code) => {
      const option = amenityOptions.find(([value]) => value === code)!;
      return { code, labelAr: option[1], labelEn: option[2] };
    });
    const generated = generateListingDescriptions({
      nameAr: property.nameAr,
      nameEn: property.nameEn,
      category: kind === 'multi_unit' ? 'building' : property.category,
      governorate: property.governorate,
      wilayat: property.wilayat,
      village: property.city,
      street: property.street,
      bedrooms: Number(primary.bedrooms) || 0,
      bathrooms: Number(primary.bathrooms) || 0,
      majlis: Number(primary.majlis) || 0,
      halls: Number(primary.halls) || 0,
      kitchens: Number(primary.kitchens) || 0,
      hasPool:
        primary.hasPool === 'true' ? true : primary.hasPool === 'false' ? false : undefined,
      area: kind === 'multi_unit' ? profile.builtUpArea || primary.area : primary.area || profile.builtUpArea,
      listingPurpose: primary.listingPurpose,
      furnishing: profile.furnishing,
      amenities: amenityPayload,
      multiUnit:
        kind === 'multi_unit'
          ? {
              shopCount: Number(unitCountShop) || units.filter((u) => u.unitKind === 'shop').length,
              showroomCount:
                Number(unitCountShowroom) || units.filter((u) => u.unitKind === 'showroom').length,
              apartmentCount:
                Number(unitCountApartment) ||
                units.filter((u) => u.unitKind === 'apartment').length,
              totalArea: profile.builtUpArea || undefined,
              yearBuilt: profile.yearBuilt || undefined,
            }
          : undefined,
    });
    setProperty((current) => ({
      ...current,
      descriptionAr: generated.descriptionAr,
      descriptionEn: generated.descriptionEn,
    }));
  }

  async function uploadFile(
    file: File,
    unitId: string,
    purpose: 'property_image' | 'attachment',
    position?: number,
  ) {
    const prepared =
      purpose === 'property_image' && file.type.startsWith('image/')
        ? await compressImageFile(file)
        : file;

    const buffer = await prepared.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const dataBase64 = btoa(binary);

    const postJson = async (csrf: string) =>
      fetch('/api/owner/media', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          unitId,
          purpose,
          position: position ?? 0,
          fileName: prepared.name,
          mimeType: prepared.type || 'application/octet-stream',
          dataBase64,
        }),
        signal: AbortSignal.timeout(55_000),
      });

    let response: Response;
    try {
      const csrf = await fetchBrowserCsrfToken(true);
      response = await postJson(csrf);
      if (response.status === 403) {
        clearBrowserCsrfCache();
        response = await postJson(await fetchBrowserCsrfToken(true));
      }
    } catch {
      throw new Error(
        ar
          ? 'تعذر رفع الصورة (انقطاع أو مهلة). صغّر الملف وأعد المحاولة.'
          : 'Could not upload photo (network/timeout). Use a smaller file and retry.',
      );
    }
    if (response.ok) return;

    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; messageAr?: string };
    } | null;
    throw new Error(
      payload?.error?.messageAr ??
        payload?.error?.message ??
        (ar ? `فشل رفع الملف (${response.status})` : `upload_failed:${response.status}`),
    );
  }

  function resolveSavedUnitIds(bundleUnits: Array<{ id: string }>): string[] {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return units
      .map((unit, index) => {
        if (uuidRe.test(unit.localId)) return unit.localId;
        return bundleUnits[index]?.id ?? '';
      })
      .filter(Boolean);
  }

  async function uploadPropertyMedia(unitIds: string[]) {
    if (!unitIds.length) return;
    type MediaJob = {
      file: File;
      unitId: string;
      purpose: 'property_image' | 'attachment';
      position: number;
    };
    const jobs: MediaJob[] = [];

    if (kind === 'multi_unit' && multiMediaMode === 'per_unit') {
      units.forEach((unit, index) => {
        const unitId = unitIds[index] ?? (unitIds.includes(unit.localId) ? unit.localId : '');
        if (!unitId) return;
        unit.images
          .filter((item) => item.file)
          .forEach((item, position) => {
            jobs.push({
              file: item.file!,
              unitId,
              purpose: 'property_image',
              position,
            });
          });
      });
    } else {
      const ordered = [
        ...images.filter((item) => item.file && item.id === coverId),
        ...images.filter((item) => item.file && item.id !== coverId),
      ];
      const targets =
        kind === 'multi_unit' && multiMediaMode === 'building' ? unitIds : [unitIds[0]!];
      ordered.forEach((item, position) => {
        for (const unitId of targets) {
          jobs.push({
            file: item.file!,
            unitId,
            purpose: 'property_image',
            position,
          });
        }
      });
    }

    const docTarget = unitIds[0]!;
    documents
      .filter(
        (doc) =>
          doc.file &&
          ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(doc.file.type),
      )
      .forEach((doc, index) => {
        jobs.push({
          file: doc.file!,
          unitId: docTarget,
          purpose: 'attachment',
          position: 1000 + index,
        });
      });

    if (!jobs.length) return;
    setSuccess(
      ar ? `جاري رفع الملفات (${jobs.length})…` : `Uploading media (${jobs.length})…`,
    );
    await mapWithConcurrency(jobs, 1, async (job) => {
      await uploadFile(job.file, job.unitId, job.purpose, job.position);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>, asDraft = false) {
    event.preventDefault();
    if (!asDraft && step < steps.length - 1) {
      goToStep(step + 1);
      return;
    }
    const issues = asDraft
      ? validateStep(0)
      : [...validateStep(0), ...validateStep(1), ...validateStep(4)];
    if (kind === 'multi_unit' && units.length < 1) {
      issues.push(t('PropertyForm.unitCountsRequired'));
    }
    if (issues.length) {
      setShowErrors(true);
      setMissingHints(issues);
      setError(asDraft ? t('PropertyForm.draftNeedsBasics') : t('PropertyForm.formBeforeSave'));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(
      asDraft
        ? ar
          ? 'جاري حفظ المسودة…'
          : 'Saving draft…'
        : ar
          ? 'جاري حفظ العقار…'
          : 'Saving property…',
    );
    try {
      const amenityPayload = amenities.map((code) => {
        const option = amenityOptions.find(([value]) => value === code)!;
        return { code, labelAr: option[1], labelEn: option[2] };
      });
      const payload = {
            asDraft,
            property: {
              ownerPartyId: selectedOwnerPartyId,
              kind,
              category: kind === 'multi_unit' ? 'building' : property.category,
              nameAr: property.nameAr,
              nameEn: property.nameEn,
              descriptionAr: property.descriptionAr || undefined,
              descriptionEn: property.descriptionEn || undefined,
              address: {
                countryCode: property.countryCode,
                governorate: property.governorate,
                wilayat: property.wilayat,
                city: property.city,
                area: property.area || property.city || undefined,
                street: property.street || undefined,
                latitude: property.latitude ? Number(property.latitude) : undefined,
                longitude: property.longitude ? Number(property.longitude) : undefined,
              },
              defaultCurrency: currency,
              profile: {
                deedNumber: profile.deedNumber || undefined,
                plotNumber: profile.plotNumber || undefined,
                municipalityNumber: profile.municipalityNumber || undefined,
                landAreaSquareMeters: profile.landArea || undefined,
                builtUpAreaSquareMeters: profile.builtUpArea || undefined,
                yearBuilt: profile.yearBuilt ? Number(profile.yearBuilt) : undefined,
                parkingSpaces: profile.parkingSpaces ? Number(profile.parkingSpaces) : undefined,
                furnishing: profile.furnishing,
                managementStartedOn: profile.managementStartedOn || undefined,
                managementFee: profile.managementFee
                  ? { amountMinor: toMinorUnits(profile.managementFee, currency), currency }
                  : undefined,
                notes: [
                  profile.notes.trim(),
                  property.mapsUrl.trim() ? `Google Maps: ${property.mapsUrl.trim()}` : '',
                ]
                  .filter(Boolean)
                  .join('\n') || undefined,
              },
              amenities: amenityPayload,
              meters: [
                ...(profile.electricityMeter
                  ? [{ utilityType: 'electricity' as const, meterNumber: profile.electricityMeter }]
                  : []),
                ...(profile.waterMeter
                  ? [{ utilityType: 'water' as const, meterNumber: profile.waterMeter }]
                  : []),
              ],
              documents: [
                ...(profile.deedNumber
                  ? [{ documentType: 'title_deed' as const, documentNumber: profile.deedNumber }]
                  : []),
                ...(profile.insuranceNumber
                  ? [
                      {
                        documentType: 'insurance' as const,
                        documentNumber: profile.insuranceNumber,
                        expiresOn: profile.insuranceExpiresOn || undefined,
                      },
                    ]
                  : []),
                ...documents.map((doc) => ({
                  documentType: doc.documentType,
                  notes:
                    doc.documentType === 'other'
                      ? ar
                        ? 'بطاقة المالك — خاص بالمالك فقط'
                        : 'Owner ID — owner-private only'
                      : doc.documentType === 'floor_plan'
                        ? ar
                          ? 'رسم مساحي (كروكي) — خاص بالمالك فقط'
                          : 'Survey sketch — owner-private only'
                        : ar
                          ? 'سند ملكية — خاص بالمالك فقط'
                          : 'Title deed — owner-private only',
                })),
              ],
            },
            units: (units.length ? units : [blankUnit(1)]).map((unit, index) => {
              const names = unitDisplayNames(unit);
              const autoCode =
                kind === 'multi_unit' && unit.code.trim()
                  ? unit.code.trim().slice(0, 32)
                  : `U-${String(index + 1).padStart(2, '0')}`;
              const unitId =
                mode === 'edit' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                  unit.localId,
                )
                  ? unit.localId
                  : undefined;
              const isCommercial = unit.unitKind === 'shop' || unit.unitKind === 'showroom';
              return {
                ...(unitId ? { id: unitId } : {}),
                code: autoCode,
                nameAr: names.nameAr || property.nameAr.trim() || autoCode,
                nameEn: names.nameEn || property.nameEn.trim() || autoCode,
                floor: unit.floor || undefined,
                bedrooms: isCommercial ? 0 : Number(unit.bedrooms || 0),
                bathrooms: isCommercial ? 0 : Number(unit.bathrooms || 0),
                majlis: isCommercial ? 0 : Number(unit.majlis || 0),
                halls: isCommercial ? 0 : Number(unit.halls || 0),
                kitchens: isCommercial ? 0 : Number(unit.kitchens || 0),
                hasPool: isCommercial ? false : unit.hasPool === 'true',
                areaSquareMeters: unit.area || undefined,
                listingPurpose: unit.listingPurpose,
                rent: {
                  amountMinor: toMinorUnits(unit.rent || '0', currency),
                  currency,
                },
                salePrice: unit.salePrice
                  ? { amountMinor: toMinorUnits(unit.salePrice, currency), currency }
                  : undefined,
                deposit: unit.deposit
                  ? { amountMinor: toMinorUnits(unit.deposit, currency), currency }
                  : undefined,
                publishWhenAvailable: asDraft ? false : unit.publishWhenAvailable,
              };
            }),
      };

      // Prefer Vercel→Neon write path (no Nest/Render). Avoids weeks of Render Free hang loops.
      if (mode === 'edit' && propertyId) {
        const patchOnce = async (csrfToken: string) =>
          fetch(`/api/owner/properties/${encodeURIComponent(propertyId)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'idempotency-key': bundleIdempotencyKey.current,
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(55_000),
          });

        clearBrowserCsrfCache();
        let csrfToken = await fetchBrowserCsrfToken(true);
        let editResponse = await patchOnce(csrfToken);
        if (editResponse.status === 403) {
          clearBrowserCsrfCache();
          csrfToken = await fetchBrowserCsrfToken(true);
          editResponse = await patchOnce(csrfToken);
        }
        if (!editResponse.ok) {
          const errBody = (await editResponse.json().catch(() => null)) as {
            error?: { code?: string; message?: string; messageAr?: string };
          } | null;
          throw new Error(
            errBody?.error?.messageAr ??
              errBody?.error?.message ??
              `${errBody?.error?.code ?? 'update_failed'}:${editResponse.status}`,
          );
        }
        const updated = (await editResponse.json()) as CreatedPropertyBundle;
        const unitIds = resolveSavedUnitIds(
          updated.units?.length ? updated.units : (initialProperty?.units ?? []).map((u) => ({ id: u.id })),
        );
        let mediaWarning: string | null = null;
        const hasNewMedia =
          images.some((item) => item.file) ||
          units.some((unit) => unit.images.some((item) => item.file)) ||
          documents.some((doc) => doc.file);
        if (hasNewMedia && unitIds.length) {
          try {
            await uploadPropertyMedia(unitIds);
          } catch (mediaError) {
            mediaWarning = ar
              ? `تم تحديث العقار، لكن رفع الصور فشل: ${mediaError instanceof Error ? mediaError.message : 'خطأ غير معروف'}. أعد رفع الصور من التعديل.`
              : `Property updated, but photo upload failed: ${mediaError instanceof Error ? mediaError.message : 'unknown error'}. Re-upload from edit.`;
          }
        }
        if (mediaWarning) {
          setSuccess(null);
          setError(mediaWarning);
          setBusy(false);
          return;
        }
        setSuccess(
          asDraft
            ? ar
              ? 'تم حفظ المسودة'
              : 'Draft saved'
            : ar
              ? 'تم تحديث بيانات العقار'
              : 'Property updated',
        );
        goToPropertyPage(locale, portal, propertyId);
        return;
      }

      let createdProperty: CreatedPropertyBundle;
      const postOnce = async (csrfToken: string) =>
        fetch('/api/owner/properties', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'idempotency-key': bundleIdempotencyKey.current,
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(55_000),
        });

      clearBrowserCsrfCache();
      let csrfToken = await fetchBrowserCsrfToken(true);
      let neonResponse = await postOnce(csrfToken);
      if (neonResponse.status === 403) {
        clearBrowserCsrfCache();
        csrfToken = await fetchBrowserCsrfToken(true);
        neonResponse = await postOnce(csrfToken);
      }
      if (neonResponse.ok) {
        createdProperty = (await neonResponse.json()) as CreatedPropertyBundle;
      } else {
        const nestPayload = (await neonResponse.json().catch(() => null)) as {
          error?: { code?: string; message?: string; messageAr?: string };
        } | null;
        // Fallback to Nest BFF only if Neon path is unconfigured.
        if (neonResponse.status === 503 && nestPayload?.error?.code === 'db_unconfigured') {
          setSuccess(ar ? 'جاري الحفظ عبر Nest…' : 'Saving via Nest…');
          createdProperty = await browserMutation<CreatedPropertyBundle>(
            '/v1/portfolio/properties',
            {
              method: 'POST',
              headers: { 'idempotency-key': bundleIdempotencyKey.current },
              body: JSON.stringify(payload),
            },
          );
        } else {
          throw new Error(
            nestPayload?.error?.messageAr ??
              nestPayload?.error?.message ??
              `save_failed:${neonResponse.status}`,
          );
        }
      }
      const unitIds = resolveSavedUnitIds(createdProperty.units ?? []);
      let mediaWarning: string | null = null;
      const hasNewMedia =
        images.some((item) => item.file) ||
        units.some((unit) => unit.images.some((item) => item.file)) ||
        documents.some((doc) => doc.file);
      if (hasNewMedia && unitIds.length) {
        try {
          await uploadPropertyMedia(unitIds);
        } catch (mediaError) {
          mediaWarning = ar
            ? `تم حفظ العقار، لكن رفع الصور فشل: ${mediaError instanceof Error ? mediaError.message : 'خطأ غير معروف'}. افتح التعديل وأعد رفع الصور.`
            : `Property saved, but photo upload failed: ${mediaError instanceof Error ? mediaError.message : 'unknown error'}. Open edit and re-upload photos.`;
        }
      }
      const serial = createdProperty.serialNumber;
      if (mediaWarning) {
        setSuccess(null);
        setError(mediaWarning);
        setBusy(false);
        window.location.assign(
          `/${locale}/${portal}/properties/${encodeURIComponent(createdProperty.id)}/edit`,
        );
        return;
      }
      setSuccess(
        asDraft
          ? ar
            ? serial
              ? `تم حفظ المسودة. الرقم المتسلسل: ${serial}`
              : 'تم حفظ المسودة'
            : serial
              ? `Draft saved. Serial: ${serial}`
              : 'Draft saved'
          : serial
            ? ar
              ? `تم الحفظ. الرقم المتسلسل للعقار: ${serial}`
              : `Saved. Property serial: ${serial}`
            : t('PropertyForm.success'),
      );
      goToPropertyPage(locale, portal, createdProperty.id);
    } catch (caught) {
      setSuccess(null);
      const api =
        caught && typeof caught === 'object' && 'code' in caught
          ? (caught as { code?: string; message?: string })
          : null;
      const raw = caught instanceof Error ? caught.message : 'request_failed';
      const code = api?.code ?? '';
      if (
        /failed to fetch|network_error|upload_network|api_unreachable|timed? ?out|aborted/i.test(
          `${raw} ${code}`,
        )
      ) {
        setError(
          ar
            ? 'تعذر حفظ العقار (انقطاع أو مهلة). حدّث الصفحة بقوة (Ctrl+Shift+R) ثم أعد المحاولة. إن استمر: سجّل الخروج وادخل من جديد.'
            : 'Could not save (network or timeout). Hard-refresh (Ctrl+Shift+R) and retry. If it persists, sign out and sign in again.',
        );
      } else {
        setError(raw);
      }
    } finally {
      setBusy(false);
    }
  }

  const primary = units[0]!;
  const previewTitle =
    locale === 'ar' ? property.nameAr || '—' : property.nameEn || '—';
  const mapCoords = parseGoogleMapsUrl(property.mapsUrl);
  const previewLocation = [property.governorate, property.wilayat, property.city]
    .filter(Boolean)
    .join(' · ');
  const rentMinor = toMinorUnits(primary.rent || '0', currency);
  const priceLabel = `${(Number(rentMinor) / (currency === 'OMR' ? 1000 : 100)).toLocaleString(
    locale === 'ar' ? 'ar-OM' : 'en-OM',
  )} ${currency}`;

  return (
    <div className="form-shell wizard-shell" data-slide={slideDir}>
      <header className="wizard-hero">
        <h1>{mode === 'edit' ? (ar ? 'تعديل العقار' : 'Edit property') : t('PropertyForm.title')}</h1>
        <p className="wizard-hero__intro">{t('PropertyForm.intro')}</p>
        {mode === 'edit' && initialProperty?.status === 'draft' ? (
          <p className="notice notice--warning" role="status" style={{ marginTop: '0.75rem' }}>
            {ar ? 'حالة العقار حالياً: مسودة' : 'Current property status: Draft'}
          </p>
        ) : null}
        <div className="wizard-hero__meta wizard-hero__meta--desktop" aria-hidden="true">
          <span>
            {ar ? 'المرحلة' : 'Step'} {step + 1} / {steps.length}
          </span>
          <span className="wizard-hero__bar">
            <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
      </header>

      <nav className="wizard-progress-compact" aria-label={t('PropertyForm.wizardStepsAria')}>
        <div className="wizard-progress-compact__now">
          <strong>
            {step + 1}
            <span>/{steps.length}</span>
          </strong>
          <em>{steps[step]}</em>
        </div>
        <div className="wizard-progress-compact__track" aria-hidden="true">
          {steps.map((label, index) => (
            <button
              key={`seg-${label}`}
              type="button"
              className={
                index === step ? 'is-current' : index < step ? 'is-done' : index <= maxReached ? 'is-reached' : undefined
              }
              disabled={index > maxReached && index !== step}
              aria-label={label}
              onClick={() => {
                if (index <= step) goToStep(index);
                else if (index === step + 1 && validateStep(step).length === 0) goToStep(index);
              }}
            />
          ))}
        </div>
      </nav>

      <nav className="wizard-progress wizard-progress--desktop" aria-label={t('PropertyForm.wizardStepsAria')}>
        <ol className="wizard-progress__list">
          {steps.map((label, index) => {
            const done = index < step;
            const current = index === step;
            const clickable =
              index < step || (index === step + 1 && validateStep(step).length === 0);
            return (
              <li
                key={label}
                className={
                  current
                    ? 'wizard-progress__item is-current'
                    : done
                      ? 'wizard-progress__item is-done'
                      : index <= maxReached
                        ? 'wizard-progress__item is-reached'
                        : 'wizard-progress__item'
                }
              >
                <button
                  type="button"
                  className="wizard-progress__btn"
                  disabled={index > maxReached && index !== step}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => {
                    if (index <= step) goToStep(index);
                    else if (clickable) goToStep(index);
                    else {
                      const issues = validateStep(step);
                      setShowErrors(true);
                      setMissingHints(issues);
                      setError(t('PropertyForm.completeBeforeNext'));
                    }
                  }}
                >
                  <span className="wizard-progress__dot" aria-hidden="true">
                    {done ? '✓' : index + 1}
                  </span>
                  <span className="wizard-progress__label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {missingHints.length ? (
        <div className="wizard-missing" role="alert">
          <strong>{t('PropertyForm.missingFields')}</strong>
          <ul>
            {missingHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card className="wizard-card">
        <CardContent>
          <form className="wizard-form" onSubmit={(event) => void submit(event)}>
            <div className="wizard-viewport">
              <div
                key={step}
                className={`wizard-pane wizard-pane--${slideDir}`}
                data-step={step + 1}
              >
            {step === 0 ? (
              <div className="form-grid">
                <div className="field span-2">
                  <label>{t('PropertyForm.basics')}</label>
                  <div className="wizard-seg" role="radiogroup">
                    <label className={kind === 'single_unit' ? 'wizard-seg__item is-active' : 'wizard-seg__item'}>
                      <input
                        type="radio"
                        name="kind"
                        checked={kind === 'single_unit'}
                        onChange={() => {
                          setKind('single_unit');
                          setUnitCountShop('');
                          setUnitCountShowroom('');
                          setUnitCountApartment('');
                          setUnits([blankUnit(1)]);
                          focusNextField();
                        }}
                      />
                      {t('PropertyForm.single')}
                    </label>
                    <label className={kind === 'multi_unit' ? 'wizard-seg__item is-active' : 'wizard-seg__item'}>
                      <input
                        type="radio"
                        name="kind"
                        checked={kind === 'multi_unit'}
                        onChange={() => {
                          setKind('multi_unit');
                          updateProperty('category', 'building');
                          const shop = unitCountShop || '0';
                          const showroom = unitCountShowroom || '0';
                          const apartment = unitCountApartment || '1';
                          setUnitCountShop(shop === '0' && showroom === '0' ? '0' : shop);
                          setUnitCountShowroom(showroom);
                          setUnitCountApartment(apartment === '0' ? '1' : apartment);
                          setUnits((current) =>
                            syncMultiUnitsFromCounts(
                              {
                                shop: Math.max(0, Number(shop) || 0),
                                showroom: Math.max(0, Number(showroom) || 0),
                                apartment: Math.max(1, Number(apartment) || 1),
                              },
                              current,
                            ),
                          );
                          focusNextField();
                        }}
                      />
                      {t('PropertyForm.multi')}
                    </label>
                  </div>
                  {kind === 'multi_unit' ? (
                    <p className="field__hint">{t('PropertyForm.multiHint')}</p>
                  ) : null}
                </div>
                {kind === 'multi_unit' ? (
                  <div className="field span-2 multi-unit-counts">
                    <label>{t('PropertyForm.unitCounts')}</label>
                    <p className="field__hint">{t('PropertyForm.unitCountsHint')}</p>
                    <div className="form-grid">
                      <Field
                        id="unit-count-shop"
                        type="number"
                        min={0}
                        label={t('PropertyForm.unitCountShop')}
                        value={unitCountShop}
                        tone={
                          (Number(unitCountShop) || 0) +
                            (Number(unitCountShowroom) || 0) +
                            (Number(unitCountApartment) || 0) >
                          0
                            ? 'ok'
                            : tone('', true, showErrors)
                        }
                        onChange={(event) => applyMultiUnitCounts({ shop: event.target.value })}
                      />
                      <Field
                        id="unit-count-showroom"
                        type="number"
                        min={0}
                        label={t('PropertyForm.unitCountShowroom')}
                        value={unitCountShowroom}
                        onChange={(event) => applyMultiUnitCounts({ showroom: event.target.value })}
                      />
                      <Field
                        id="unit-count-apartment"
                        type="number"
                        min={0}
                        label={t('PropertyForm.unitCountApartment')}
                        value={unitCountApartment}
                        onChange={(event) =>
                          applyMultiUnitCounts({ apartment: event.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : null}
                <SelectField
                  id="country"
                  label={t('PropertyForm.country')}
                  value={property.countryCode}
                  tone="ok"
                  onChange={(event) => {
                    const code = event.target.value as CountryPackCode;
                    updateProperty('countryCode', code);
                    setCurrency(countryPacks[code].defaultCurrency);
                    updateProperty('governorate', '');
                    updateProperty('wilayat', '');
                    updateProperty('city', '');
                    focusNextField(event.currentTarget);
                  }}
                  required
                >
                  {Object.values(countryPacks).map((pack) => (
                    <option key={pack.countryCode} value={pack.countryCode}>
                      {pack.name[locale]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="category"
                  label={t('PropertyForm.category')}
                  value={kind === 'multi_unit' ? 'building' : property.category}
                  tone={tone(property.category, true, showErrors)}
                  onChange={(event) =>
                    onSelectAdvance(event, (value) => updateProperty('category', value))
                  }
                  required
                  disabled={kind === 'multi_unit'}
                >
                  {(
                    [
                      ['apartment', 'categoryApartment'],
                      ['villa', 'categoryVilla'],
                      ['building', 'categoryBuilding'],
                      ['office', 'categoryOffice'],
                      ['shop', 'categoryShop'],
                      ['warehouse', 'categoryWarehouse'],
                      ['land', 'categoryLand'],
                      ['other', 'categoryOther'],
                    ] as const
                  ).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(`PropertyForm.${key}`)}
                    </option>
                  ))}
                </SelectField>
                {kind === 'multi_unit' ? (
                  <p className="field__hint span-2">{t('PropertyForm.multiCategoryHint')}</p>
                ) : null}
                <SelectField
                  id="currency"
                  name="currency"
                  label={t('Common.currency')}
                  value={currency}
                  tone="ok"
                  onChange={(event) => {
                    setCurrency(event.target.value as CurrencyCode);
                    focusNextField(event.currentTarget);
                  }}
                  required
                >
                  {supportedCurrencyCodes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </SelectField>
                <div className="bilingual-pair span-2">
                  <Field
                    id="nameAr"
                    label={t('PropertyForm.nameAr')}
                    value={property.nameAr}
                    tone={tone(property.nameAr, true, showErrors)}
                    onChange={(event) => updateProperty('nameAr', event.target.value)}
                    minLength={2}
                    maxLength={160}
                    required
                  />
                  <div className="bilingual-pair__actions">
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={translating !== null || !property.nameAr.trim()}
                      onClick={() =>
                        void translateField(
                          property.nameAr,
                          'en',
                          (value) => updateProperty('nameEn', value),
                          'name-en',
                        )
                      }
                    >
                      {translating === 'name-en' ? '…' : 'AR → EN'}
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={translating !== null || !property.nameEn.trim()}
                      onClick={() =>
                        void translateField(
                          property.nameEn,
                          'ar',
                          (value) => updateProperty('nameAr', value),
                          'name-ar',
                        )
                      }
                    >
                      {translating === 'name-ar' ? '…' : 'EN → AR'}
                    </Button>
                  </div>
                  <Field
                    id="nameEn"
                    label={t('PropertyForm.nameEn')}
                    value={property.nameEn}
                    tone={tone(property.nameEn, true, showErrors)}
                    onChange={(event) => updateProperty('nameEn', event.target.value)}
                    minLength={2}
                    maxLength={160}
                    required
                    dir="ltr"
                  />
                </div>

                {property.countryCode === 'OM' ? (
                  <>
                    <SelectField
                      id="governorate"
                      label={t('PropertyForm.governorate')}
                      value={property.governorate}
                      tone={tone(property.governorate, true, showErrors)}
                      onChange={(event) => {
                        updateProperty('governorate', event.target.value);
                        updateProperty('wilayat', '');
                        updateProperty('city', '');
                        focusNextField(event.currentTarget);
                      }}
                      required
                    >
                      <option value="">{t('PropertyForm.selectGovernorate')}</option>
                      {omanLocations.map((g) => (
                        <option key={g.en} value={g.ar}>
                          {ar ? g.ar : g.en}
                        </option>
                      ))}
                    </SelectField>
                    {property.governorate ? (
                      <SelectField
                        id="wilayat"
                        label={t('PropertyForm.wilayat')}
                        value={property.wilayat}
                        tone={tone(property.wilayat, true, showErrors)}
                        onChange={(event) => {
                          updateProperty('wilayat', event.target.value);
                          updateProperty('city', '');
                          focusNextField(event.currentTarget);
                        }}
                        required
                      >
                        <option value="">{t('PropertyForm.selectWilayat')}</option>
                        {(selectedGov?.states ?? []).map((s) => (
                          <option key={s.en} value={s.ar}>
                            {ar ? s.ar : s.en}
                          </option>
                        ))}
                      </SelectField>
                    ) : null}
                    {property.wilayat ? (
                      <SelectField
                        id="village"
                        label={t('PropertyForm.village')}
                        value={property.city}
                        tone={tone(property.city, true, showErrors)}
                        onChange={(event) =>
                          onSelectAdvance(event, (value) => updateProperty('city', value))
                        }
                        required
                      >
                        <option value="">{t('PropertyForm.selectVillage')}</option>
                        {(selectedWilayat?.villages ?? []).map((v) => (
                          <option key={v.ar} value={v.ar}>
                            {v.ar}
                          </option>
                        ))}
                      </SelectField>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Field
                      id="governorate"
                      label={t('PropertyForm.governorate')}
                      value={property.governorate}
                      tone={tone(property.governorate, true, showErrors)}
                      onChange={(event) => updateProperty('governorate', event.target.value)}
                      required
                    />
                    <Field
                      id="wilayat"
                      label={t('PropertyForm.wilayat')}
                      value={property.wilayat}
                      tone={tone(property.wilayat, true, showErrors)}
                      onChange={(event) => updateProperty('wilayat', event.target.value)}
                      required
                    />
                    <Field
                      id="city"
                      label={t('PropertyForm.city')}
                      value={property.city}
                      tone={tone(property.city, true, showErrors)}
                      onChange={(event) => updateProperty('city', event.target.value)}
                      required
                    />
                  </>
                )}
                <Field
                  id="street"
                  label={t('PropertyForm.street')}
                  value={property.street}
                  onChange={(event) => updateProperty('street', event.target.value)}
                />
                <div className="span-2 maps-field">
                  <div className="maps-field__row">
                    <Field
                      id="mapsUrl"
                      label={t('PropertyForm.mapsUrl')}
                      value={property.mapsUrl}
                      tone={
                        !property.mapsUrl.trim()
                          ? tone('', true, showErrors)
                          : mapCoords
                            ? 'ok'
                            : showErrors
                              ? 'missing'
                              : 'neutral'
                      }
                      onChange={(event) => applyMapsUrl(event.target.value)}
                      hint={t('PropertyForm.mapsUrlHint')}
                      required
                      dir="ltr"
                      placeholder="https://maps.google.com/..."
                    />
                    <div className="maps-field__pick">
                      <Button type="button" variant="quiet" onClick={() => setMapPickerOpen(true)}>
                        {t('PropertyForm.pickOnMap')}
                      </Button>
                    </div>
                  </div>
                  {mapCoords ? (
                    <div className="maps-preview">
                      <p className="maps-preview__label">{t('PropertyForm.mapsPreview')}</p>
                      <iframe
                        title={t('PropertyForm.mapsPreview')}
                        className="maps-preview__frame"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={googleMapsEmbedSrc(mapCoords.latitude, mapCoords.longitude)}
                      />
                    </div>
                  ) : property.mapsUrl.trim() ? (
                    <p className="field__error">{t('PropertyForm.mapsUrlInvalid')}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div>
                {kind === 'multi_unit' ? (
                  <>
                    <div className="form-grid" style={{ marginBottom: '1rem' }}>
                      <Field
                        id="multi-total-area"
                        inputMode="decimal"
                        label={t('PropertyForm.multiUnitTotalArea')}
                        value={profile.builtUpArea}
                        tone={tone(profile.builtUpArea, true, showErrors)}
                        onChange={(event) => updateProfile('builtUpArea', event.target.value)}
                        required
                        hint={t('PropertyForm.multiUnitTotalAreaHint')}
                      />
                      <p className="span-2 field__hint">{t('PropertyForm.multiUnitsEditorHint')}</p>
                    </div>
                    {units.length === 0 ? (
                      <p className="notice notice--error" role="alert">
                        {t('PropertyForm.unitCountsRequired')}
                      </p>
                    ) : null}
                    {units.map((unit, index) => {
                      const typeLabel =
                        unit.unitKind === 'shop'
                          ? t('PropertyForm.unitKindShop')
                          : unit.unitKind === 'showroom'
                            ? t('PropertyForm.unitKindShowroom')
                            : t('PropertyForm.unitKindApartment');
                      const isApartment = unit.unitKind === 'apartment';
                      const sameKind = units.filter((item) => item.unitKind === unit.unitKind);
                      const sameKindIndex = sameKind.findIndex(
                        (item) => item.localId === unit.localId,
                      );
                      const canCloneToRest =
                        sameKindIndex === 0 && sameKind.length > 1;
                      return (
                        <fieldset className="unit-editor" key={unit.localId}>
                          <legend className="sr-only">
                            {typeLabel} {index + 1}
                          </legend>
                          <div className="unit-editor__head">
                            <h3>
                              {typeLabel} · {unit.code || index + 1}
                            </h3>
                            {canCloneToRest ? (
                              <Button
                                type="button"
                                variant="quiet"
                                onClick={() => cloneUnitDetailsToSameKind(unit.localId)}
                              >
                                {t('PropertyForm.cloneUnitDetails')}
                              </Button>
                            ) : null}
                          </div>
                          {canCloneToRest ? (
                            <p className="field__hint" style={{ marginTop: 0 }}>
                              {t('PropertyForm.cloneUnitDetailsHint')}
                            </p>
                          ) : null}
                          <div className="form-grid">
                            <Field
                              id={`unit-number-${unit.localId}`}
                              label={t('PropertyForm.unitNumber')}
                              value={unit.code}
                              tone={tone(unit.code, true, showErrors)}
                              onChange={(event) =>
                                updateUnit(unit.localId, 'code', event.target.value)
                              }
                              required
                            />
                            <Field
                              id={`unit-area-${unit.localId}`}
                              inputMode="decimal"
                              label={t('PropertyForm.area')}
                              value={unit.area}
                              tone={tone(unit.area, true, showErrors)}
                              onChange={(event) =>
                                updateUnit(unit.localId, 'area', event.target.value)
                              }
                              required
                            />
                            <SelectField
                              id={`unit-purpose-${unit.localId}`}
                              label={t('PropertyForm.listingPurpose')}
                              value={unit.listingPurpose}
                              tone="ok"
                              onChange={(event) =>
                                updateUnit(unit.localId, 'listingPurpose', event.target.value)
                              }
                              required
                            >
                              <option value="rent">{t('PropertyForm.forRent')}</option>
                              <option value="sale">{t('PropertyForm.forSale')}</option>
                              <option value="both">{t('PropertyForm.forBoth')}</option>
                            </SelectField>
                            <Field
                              id={`unit-rent-${unit.localId}`}
                              inputMode="decimal"
                              label={`${t('PropertyForm.rent')} (${currency})`}
                              value={unit.rent}
                              tone={
                                unit.listingPurpose === 'sale'
                                  ? 'neutral'
                                  : tone(unit.rent, true, showErrors)
                              }
                              onChange={(event) =>
                                updateUnit(unit.localId, 'rent', event.target.value)
                              }
                              required={unit.listingPurpose !== 'sale'}
                            />
                            <Field
                              id={`unit-sale-price-${unit.localId}`}
                              inputMode="decimal"
                              label={`${t('PropertyForm.salePrice')} (${currency})`}
                              value={unit.salePrice}
                              tone={
                                unit.listingPurpose === 'rent'
                                  ? 'neutral'
                                  : tone(unit.salePrice, true, showErrors)
                              }
                              onChange={(event) =>
                                updateUnit(unit.localId, 'salePrice', event.target.value)
                              }
                              required={unit.listingPurpose !== 'rent'}
                            />
                            <Field
                              id={`unit-deposit-${unit.localId}`}
                              inputMode="decimal"
                              label={`${t('PropertyForm.deposit')} (${currency})`}
                              value={unit.deposit}
                              onChange={(event) =>
                                updateUnit(unit.localId, 'deposit', event.target.value)
                              }
                              hint={t('PropertyForm.depositHint')}
                            />
                            {isApartment ? (
                              <>
                                <SelectField
                                  id={`unit-floor-${unit.localId}`}
                                  label={t('PropertyForm.floor')}
                                  value={unit.floor}
                                  onChange={(event) =>
                                    updateUnit(unit.localId, 'floor', event.target.value)
                                  }
                                >
                                  <option value="">{t('PropertyForm.selectFloor')}</option>
                                  {FLOOR_OPTIONS.map((value) => (
                                    <option key={value} value={value}>
                                      {value === '0' ? t('PropertyForm.floorGround') : value}
                                    </option>
                                  ))}
                                </SelectField>
                                <SelectField
                                  id={`unit-beds-${unit.localId}`}
                                  label={t('PropertyForm.bedrooms')}
                                  value={unit.bedrooms}
                                  tone={tone(unit.bedrooms, true, showErrors)}
                                  onChange={(event) =>
                                    updateUnit(unit.localId, 'bedrooms', event.target.value)
                                  }
                                  required
                                >
                                  <option value="">{t('PropertyForm.selectBedrooms')}</option>
                                  {BEDROOM_OPTIONS.map((value) => (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  ))}
                                </SelectField>
                                <SelectField
                                  id={`unit-baths-${unit.localId}`}
                                  label={t('PropertyForm.bathrooms')}
                                  value={unit.bathrooms}
                                  tone={tone(unit.bathrooms, true, showErrors)}
                                  onChange={(event) =>
                                    updateUnit(unit.localId, 'bathrooms', event.target.value)
                                  }
                                  required
                                >
                                  <option value="">{t('PropertyForm.selectBathrooms')}</option>
                                  {BATHROOM_OPTIONS.map((value) => (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  ))}
                                </SelectField>
                                <SelectField
                                  id={`unit-majlis-${unit.localId}`}
                                  label={t('PropertyForm.majlis')}
                                  value={unit.majlis}
                                  tone={tone(unit.majlis, true, showErrors)}
                                  onChange={(event) =>
                                    updateUnit(unit.localId, 'majlis', event.target.value)
                                  }
                                  required
                                >
                                  <option value="">{t('PropertyForm.selectMajlis')}</option>
                                  {ROOM_COUNT_OPTIONS.map((value) => (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  ))}
                                </SelectField>
                                <SelectField
                                  id={`unit-halls-${unit.localId}`}
                                  label={t('PropertyForm.halls')}
                                  value={unit.halls}
                                  tone={tone(unit.halls, true, showErrors)}
                                  onChange={(event) =>
                                    updateUnit(unit.localId, 'halls', event.target.value)
                                  }
                                  required
                                >
                                  <option value="">{t('PropertyForm.selectHalls')}</option>
                                  {ROOM_COUNT_OPTIONS.map((value) => (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  ))}
                                </SelectField>
                              </>
                            ) : (
                              <p className="span-2 field__hint">
                                {t('PropertyForm.commercialUnitHint')}
                              </p>
                            )}
                            <div className="span-2 publish-hint">
                              <label className="checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={unit.publishWhenAvailable}
                                  onChange={(event) =>
                                    updateUnit(
                                      unit.localId,
                                      'publishWhenAvailable',
                                      event.target.checked,
                                    )
                                  }
                                />
                                {t('PropertyForm.publish')}
                              </label>
                              <p className="field__hint">{t('PropertyForm.publishHint')}</p>
                            </div>
                          </div>
                        </fieldset>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {units.map((unit, index) => (
                      <fieldset className="unit-editor" key={unit.localId}>
                        <legend className="sr-only">
                          {t('PropertyForm.unit')} {index + 1}
                        </legend>
                        <div className="unit-editor__head">
                          <h3>
                            {t('PropertyForm.unit')} {index + 1}
                          </h3>
                        </div>
                        <div className="form-grid">
                          <p className="span-2 field__hint">{t('PropertyForm.nameSharedHint')}</p>
                          <div className="field">
                            <label>{t('PropertyForm.code')}</label>
                            <div className="wizard-readonly" dir="ltr">
                              {`U-${String(index + 1).padStart(2, '0')}`}
                            </div>
                            <p className="field__hint">{t('PropertyForm.codeAutoHint')}</p>
                          </div>
                          <SelectField
                            id={`unit-floor-${unit.localId}`}
                            label={t('PropertyForm.floor')}
                            value={unit.floor}
                            tone={tone(unit.floor, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'floor', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectFloor')}</option>
                            {FLOOR_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value === '0' ? t('PropertyForm.floorGround') : value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-beds-${unit.localId}`}
                            label={t('PropertyForm.bedrooms')}
                            value={unit.bedrooms}
                            tone={tone(unit.bedrooms, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'bedrooms', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectBedrooms')}</option>
                            {BEDROOM_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-baths-${unit.localId}`}
                            label={t('PropertyForm.bathrooms')}
                            value={unit.bathrooms}
                            tone={tone(unit.bathrooms, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'bathrooms', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectBathrooms')}</option>
                            {BATHROOM_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-majlis-${unit.localId}`}
                            label={t('PropertyForm.majlis')}
                            value={unit.majlis}
                            tone={tone(unit.majlis, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'majlis', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectMajlis')}</option>
                            {ROOM_COUNT_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-halls-${unit.localId}`}
                            label={t('PropertyForm.halls')}
                            value={unit.halls}
                            tone={tone(unit.halls, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'halls', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectHalls')}</option>
                            {ROOM_COUNT_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-kitchens-${unit.localId}`}
                            label={t('PropertyForm.kitchens')}
                            value={unit.kitchens}
                            tone={tone(unit.kitchens, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'kitchens', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectKitchens')}</option>
                            {ROOM_COUNT_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`unit-pool-${unit.localId}`}
                            label={t('PropertyForm.hasPool')}
                            value={unit.hasPool}
                            tone={tone(unit.hasPool, true, showErrors)}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'hasPool', event.target.value)
                            }
                            required
                          >
                            <option value="">{t('PropertyForm.selectPool')}</option>
                            <option value="true">{t('PropertyForm.poolAvailable')}</option>
                            <option value="false">{t('PropertyForm.poolUnavailable')}</option>
                          </SelectField>
                          <Field
                            id={`unit-area-${unit.localId}`}
                            inputMode="decimal"
                            label={t('PropertyForm.area')}
                            value={unit.area}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'area', event.target.value)
                            }
                          />
                          <SelectField
                            id={`unit-purpose-${unit.localId}`}
                            label={t('PropertyForm.listingPurpose')}
                            value={unit.listingPurpose}
                            tone="ok"
                            onChange={(event) =>
                              updateUnit(unit.localId, 'listingPurpose', event.target.value)
                            }
                            required
                          >
                            <option value="rent">{t('PropertyForm.forRent')}</option>
                            <option value="sale">{t('PropertyForm.forSale')}</option>
                            <option value="both">{t('PropertyForm.forBoth')}</option>
                          </SelectField>
                          <Field
                            id={`unit-rent-${unit.localId}`}
                            inputMode="decimal"
                            label={`${t('PropertyForm.rent')} (${currency})`}
                            value={unit.rent}
                            tone={
                              unit.listingPurpose === 'sale'
                                ? 'neutral'
                                : tone(unit.rent, true, showErrors)
                            }
                            onChange={(event) =>
                              updateUnit(unit.localId, 'rent', event.target.value)
                            }
                            required={unit.listingPurpose !== 'sale'}
                          />
                          <Field
                            id={`unit-sale-price-${unit.localId}`}
                            inputMode="decimal"
                            label={`${t('PropertyForm.salePrice')} (${currency})`}
                            value={unit.salePrice}
                            tone={
                              unit.listingPurpose === 'rent'
                                ? 'neutral'
                                : tone(unit.salePrice, true, showErrors)
                            }
                            onChange={(event) =>
                              updateUnit(unit.localId, 'salePrice', event.target.value)
                            }
                            required={unit.listingPurpose !== 'rent'}
                          />
                          <Field
                            id={`unit-deposit-${unit.localId}`}
                            inputMode="decimal"
                            label={`${t('PropertyForm.deposit')} (${currency})`}
                            value={unit.deposit}
                            onChange={(event) =>
                              updateUnit(unit.localId, 'deposit', event.target.value)
                            }
                            hint={t('PropertyForm.depositHint')}
                          />
                          <div className="span-2 publish-hint">
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={unit.publishWhenAvailable}
                                onChange={(event) =>
                                  updateUnit(
                                    unit.localId,
                                    'publishWhenAvailable',
                                    event.target.checked,
                                  )
                                }
                              />
                              {t('PropertyForm.publish')}
                            </label>
                            <p className="field__hint">{t('PropertyForm.publishHint')}</p>
                          </div>
                        </div>
                      </fieldset>
                    ))}
                  </>
                )}
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <div className="form-grid">
                  <Field
                    id="land-area"
                    inputMode="decimal"
                    label={ar ? 'مساحة الأرض (م²)' : 'Land area (m²)'}
                    value={profile.landArea}
                    onChange={(event) => updateProfile('landArea', event.target.value)}
                  />
                  <Field
                    id="built-area"
                    inputMode="decimal"
                    label={
                      kind === 'multi_unit'
                        ? t('PropertyForm.multiUnitTotalArea')
                        : ar
                          ? 'المساحة المبنية (م²)'
                          : 'Built-up area (m²)'
                    }
                    value={profile.builtUpArea}
                    onChange={(event) => updateProfile('builtUpArea', event.target.value)}
                  />
                  <Field
                    id="year-built"
                    type="number"
                    min={1800}
                    max={2200}
                    label={ar ? 'سنة البناء' : 'Year built'}
                    value={profile.yearBuilt}
                    onChange={(event) => updateProfile('yearBuilt', event.target.value)}
                  />
                  <Field
                    id="parking-spaces"
                    type="number"
                    min={0}
                    label={ar ? 'عدد المواقف' : 'Parking spaces'}
                    value={profile.parkingSpaces}
                    onChange={(event) => updateProfile('parkingSpaces', event.target.value)}
                  />
                  <SelectField
                    id="furnishing"
                    label={ar ? 'التأثيث' : 'Furnishing'}
                    value={profile.furnishing}
                    onChange={(event) => updateProfile('furnishing', event.target.value)}
                  >
                    <option value="unfurnished">{ar ? 'غير مؤثث' : 'Unfurnished'}</option>
                    <option value="semi_furnished">{ar ? 'شبه مؤثث' : 'Semi-furnished'}</option>
                    <option value="furnished">{ar ? 'مؤثث' : 'Furnished'}</option>
                  </SelectField>
                </div>
                <fieldset className="amenity-picker">
                  <legend>{t('PropertyForm.amenitiesLegend')}</legend>
                  <div className="amenity-picker__grid">
                    {amenityOptions.map(([code, labelAr, labelEn, icon]) => (
                      <label
                        className={
                          amenities.includes(code)
                            ? 'amenity-chip is-selected'
                            : 'amenity-chip'
                        }
                        key={code}
                      >
                        <input
                          type="checkbox"
                          checked={amenities.includes(code)}
                          onChange={(event) =>
                            setAmenities((current) =>
                              event.target.checked
                                ? [...current, code]
                                : current.filter((value) => value !== code),
                            )
                          }
                        />
                        <span className="amenity-chip__icon" aria-hidden="true">
                          {icon}
                        </span>
                        <span>{ar ? labelAr : labelEn}</span>
                      </label>
                    ))}
                  </div>
                  <div className="amenity-custom">
                    <div className="bilingual-pair">
                      <Field
                        id="custom-amenity-ar"
                        label={t('PropertyForm.customAmenityAr')}
                        value={customDraft.ar}
                        onChange={(event) =>
                          setCustomDraft((c) => ({ ...c, ar: event.target.value }))
                        }
                      />
                      <div className="bilingual-pair__actions">
                        <span className="bilingual-pair__hint">AR ‖ EN</span>
                      </div>
                      <Field
                        id="custom-amenity-en"
                        label={t('PropertyForm.customAmenityEn')}
                        value={customDraft.en}
                        onChange={(event) =>
                          setCustomDraft((c) => ({ ...c, en: event.target.value }))
                        }
                        dir="ltr"
                      />
                    </div>
                    <Button type="button" variant="quiet" onClick={addCustomAmenity}>
                      {t('PropertyForm.addCustomAmenity')}
                    </Button>
                  </div>
                </fieldset>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="form-grid">
                <SelectField
                  id="owner-party"
                  label={ar ? 'الملكية باسم' : 'Ownership under'}
                  value={selectedOwnerPartyId}
                  onChange={(event) => setSelectedOwnerPartyId(event.target.value)}
                  required
                >
                  {(ownerPartyOptions.length
                    ? ownerPartyOptions
                    : [{ id: ownerPartyId, displayName: ar ? 'حسابي' : 'My account', type: 'person' }]
                  ).map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.displayName}
                      {party.id === ownerPartyId
                        ? ar
                          ? ' (حسابي)'
                          : ' (me)'
                        : ''}
                    </option>
                  ))}
                </SelectField>
                <p className="muted span-2">
                  {ar
                    ? 'اختر الطرف الذي سيُسجَّل كمالك للعقار في سجل الملكية. يمكنك إضافة أطراف من قائمة الأطراف والجهات.'
                    : 'Choose the party recorded as owner. Add more parties from the Parties section.'}
                </p>
                <Field
                  id="deed-number"
                  label={ar ? 'رقم سند الملكية' : 'Title deed number'}
                  value={profile.deedNumber}
                  onChange={(event) => updateProfile('deedNumber', event.target.value)}
                />
                <Field
                  id="plot-number"
                  label={ar ? 'رقم القطعة' : 'Plot number'}
                  value={profile.plotNumber}
                  onChange={(event) => updateProfile('plotNumber', event.target.value)}
                />
                <Field
                  id="municipality-number"
                  label={ar ? 'الرقم البلدي' : 'Municipality number'}
                  value={profile.municipalityNumber}
                  onChange={(event) => updateProfile('municipalityNumber', event.target.value)}
                />
                <Field
                  id="insurance-number"
                  label={ar ? 'رقم وثيقة التأمين' : 'Insurance policy number'}
                  value={profile.insuranceNumber}
                  onChange={(event) => updateProfile('insuranceNumber', event.target.value)}
                />
                <Field
                  id="insurance-expiry"
                  type="date"
                  label={ar ? 'انتهاء التأمين' : 'Insurance expiry'}
                  value={profile.insuranceExpiresOn}
                  onChange={(event) => updateProfile('insuranceExpiresOn', event.target.value)}
                />
                <Field
                  id="electricity-meter"
                  label={ar ? 'عداد الكهرباء' : 'Electricity meter'}
                  value={profile.electricityMeter}
                  onChange={(event) => updateProfile('electricityMeter', event.target.value)}
                />
                <Field
                  id="water-meter"
                  label={ar ? 'عداد المياه' : 'Water meter'}
                  value={profile.waterMeter}
                  onChange={(event) => updateProfile('waterMeter', event.target.value)}
                />
                <TextAreaField
                  id="property-notes"
                  label={ar ? 'ملاحظات تشغيلية وقانونية' : 'Operational/legal notes'}
                  value={profile.notes}
                  onChange={(event) => updateProfile('notes', event.target.value)}
                  maxLength={5000}
                />
                <div className="span-2 private-docs">
                  <div className="private-docs__banner" role="note">
                    <strong>{t('PropertyForm.privateDocsTitle')}</strong>
                    <p>{t('PropertyForm.privateDocsNote')}</p>
                  </div>
                  {(
                    [
                      ['title_deed', 'docOwnership'],
                      ['floor_plan', 'docSurvey'],
                      ['other', 'docOwnerId'],
                    ] as const
                  ).map(([docType, labelKey]) => {
                    const current = documents.find((item) => item.documentType === docType);
                    const inputId = `property-doc-${docType}`;
                    return (
                      <div className="private-docs__slot" key={docType}>
                        <div className="private-docs__head">
                          <strong>{t(`PropertyForm.${labelKey}`)}</strong>
                          <span>{t('PropertyForm.optional')}</span>
                        </div>
                        <label className="private-docs__drop" htmlFor={inputId}>
                          <input
                            id={inputId}
                            className="sr-only"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) => selectDocuments(docType, event)}
                          />
                          {current ? (
                            <span className="private-docs__file">
                              <button
                                type="button"
                                className="media-icon"
                                onClick={(event) => {
                                  event.preventDefault();
                                  setPreviewId(current.id);
                                }}
                              >
                                <span aria-hidden="true">{current.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
                                <small>
                                  {current.file?.name ||
                                    current.label ||
                                    (current.existing
                                      ? ar
                                        ? 'مستند محفوظ'
                                        : 'Saved document'
                                      : t('PropertyForm.chooseFile'))}
                                </small>
                              </button>
                            </span>
                          ) : (
                            <span>{t('PropertyForm.chooseFile')}</span>
                          )}
                        </label>
                        {current ? (
                          <Button type="button" variant="quiet" onClick={() => removeDocument(docType)}>
                            {t('PropertyForm.removeFile')}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="upload-zone">
                {kind === 'multi_unit' ? (
                  <div className="field span-2" style={{ marginBottom: '1rem' }}>
                    <label>{t('PropertyForm.multiMediaMode')}</label>
                    <div className="wizard-seg" role="radiogroup">
                      <label
                        className={
                          multiMediaMode === 'building'
                            ? 'wizard-seg__item is-active'
                            : 'wizard-seg__item'
                        }
                      >
                        <input
                          type="radio"
                          name="multi-media-mode"
                          checked={multiMediaMode === 'building'}
                          onChange={() => setMultiMediaMode('building')}
                        />
                        {t('PropertyForm.multiMediaBuilding')}
                      </label>
                      <label
                        className={
                          multiMediaMode === 'per_unit'
                            ? 'wizard-seg__item is-active'
                            : 'wizard-seg__item'
                        }
                      >
                        <input
                          type="radio"
                          name="multi-media-mode"
                          checked={multiMediaMode === 'per_unit'}
                          onChange={() => setMultiMediaMode('per_unit')}
                        />
                        {t('PropertyForm.multiMediaPerUnit')}
                      </label>
                    </div>
                    <p className="field__hint">{t('PropertyForm.multiMediaModeHint')}</p>
                  </div>
                ) : null}

                {kind !== 'multi_unit' || multiMediaMode === 'building' ? (
                  <>
                    <label htmlFor="property-images" className="upload-zone__label">
                      <strong>
                        {kind === 'multi_unit'
                          ? t('PropertyForm.buildingImages')
                          : t('PropertyForm.images')}
                      </strong>
                      <p>{t('PropertyForm.imagesOptional')}</p>
                      {kind === 'multi_unit' ? (
                        <p className="field__hint">{t('PropertyForm.buildingImagesHint')}</p>
                      ) : null}
                      <p className="field__hint">{t('PropertyForm.imagesAppendHint')}</p>
                      <p className="field__hint">{t('PropertyForm.imageHelp')}</p>
                      <span className="button button--quiet">
                        {images.length
                          ? t('PropertyForm.addMoreImages')
                          : t('PropertyForm.chooseImages')}
                      </span>
                    </label>
                    <input
                      id="property-images"
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={selectImages}
                    />
                    <ul className="media-icon-grid">
                      {images.map((item) => (
                        <li key={item.id} className={coverId === item.id ? 'is-cover' : undefined}>
                          <button
                            type="button"
                            className="media-thumb"
                            onClick={() => setPreviewId(item.id)}
                          >
                            <img src={item.url} alt="" />
                          </button>
                          <div className="media-thumb__actions">
                            <label className="checkbox-row">
                              <input
                                type="radio"
                                name="cover"
                                checked={coverId === item.id}
                                onChange={() => setCoverId(item.id)}
                              />
                              {t('PropertyForm.coverImage')}
                            </label>
                            <Button
                              type="button"
                              variant="quiet"
                              disabled={removingIds.has(item.id) || busy}
                              onClick={() => void removeImage(item.id)}
                            >
                              {removingIds.has(item.id)
                                ? ar
                                  ? 'جارٍ الحذف…'
                                  : 'Removing…'
                                : t('PropertyForm.removeImage')}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {images.length >= 12 ? (
                      <p className="field__hint">{t('PropertyForm.imagesMaxReached')}</p>
                    ) : null}
                  </>
                ) : (
                  <div className="form-grid">
                    <p className="span-2 field__hint">{t('PropertyForm.perUnitImagesHint')}</p>
                    {units.map((unit) => {
                      const typeLabel =
                        unit.unitKind === 'shop'
                          ? t('PropertyForm.unitKindShop')
                          : unit.unitKind === 'showroom'
                            ? t('PropertyForm.unitKindShowroom')
                            : t('PropertyForm.unitKindApartment');
                      const inputId = `unit-images-${unit.localId}`;
                      return (
                        <div className="span-2 unit-editor" key={unit.localId}>
                          <div className="unit-editor__head">
                            <h3>
                              {typeLabel} · {unit.code}
                            </h3>
                          </div>
                          <label htmlFor={inputId} className="upload-zone__label">
                            <strong>{t('PropertyForm.unitImages')}</strong>
                            <span className="button button--quiet">
                              {unit.images.length
                                ? t('PropertyForm.addMoreImages')
                                : t('PropertyForm.chooseImages')}
                            </span>
                          </label>
                          <input
                            id={inputId}
                            className="sr-only"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            onChange={(event) => selectUnitImages(unit.localId, event)}
                          />
                          <ul className="media-icon-grid">
                            {unit.images.map((item) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  className="media-thumb"
                                  onClick={() => setPreviewId(item.id)}
                                >
                                  <img src={item.url} alt="" />
                                </button>
                                <div className="media-thumb__actions">
                                  <Button
                                    type="button"
                                    variant="quiet"
                                    disabled={removingIds.has(item.id) || busy}
                                    onClick={() => void removeImage(item.id)}
                                  >
                                    {removingIds.has(item.id)
                                      ? ar
                                        ? 'جارٍ الحذف…'
                                        : 'Removing…'
                                      : t('PropertyForm.removeImage')}
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {step === 5 ? (
              <div className="wizard-review">
                <section className="wizard-review__copy">
                  <header className="wizard-review__head">
                    <h2>{t('PropertyForm.professionalDescription')}</h2>
                    <div className="hero-actions">
                      <Button type="button" variant="quiet" onClick={runAiDescription}>
                        {t('PropertyForm.generateDescription')}
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={translating !== null || !property.descriptionAr.trim()}
                        onClick={() =>
                          void translateField(
                            property.descriptionAr,
                            'en',
                            (value) => updateProperty('descriptionEn', value),
                            'desc-en',
                          )
                        }
                      >
                        {translating === 'desc-en' ? '…' : t('PropertyForm.translateToEn')}
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={translating !== null || !property.descriptionEn.trim()}
                        onClick={() =>
                          void translateField(
                            property.descriptionEn,
                            'ar',
                            (value) => updateProperty('descriptionAr', value),
                            'desc-ar',
                          )
                        }
                      >
                        {translating === 'desc-ar' ? '…' : t('PropertyForm.translateToAr')}
                      </Button>
                    </div>
                  </header>
                  <div className="bilingual-pair bilingual-pair--tall">
                    <TextAreaField
                      id="descriptionAr"
                      label={t('PropertyForm.descriptionAr')}
                      value={property.descriptionAr}
                      onChange={(event) => updateProperty('descriptionAr', event.target.value)}
                      maxLength={5000}
                    />
                    <div className="bilingual-pair__actions">
                      <span className="bilingual-pair__hint">AR ‖ EN</span>
                    </div>
                    <TextAreaField
                      id="descriptionEn"
                      label={t('PropertyForm.descriptionEn')}
                      value={property.descriptionEn}
                      onChange={(event) => updateProperty('descriptionEn', event.target.value)}
                      maxLength={5000}
                      dir="ltr"
                    />
                  </div>
                  <p className="field__hint">{t('PropertyForm.serialHint')}</p>
                </section>
              </div>
            ) : null}

            {step === 6 ? (
              <div className="listing-showcase">
                <header className="listing-showcase__hero">
                  <p className="listing-showcase__eyebrow">{t('PropertyForm.listingPreviewHint')}</p>
                  <h2>{previewTitle}</h2>
                  <p>{previewLocation || t('PropertyForm.locationFallback')}</p>
                  <div className="listing-showcase__price">
                    <strong>{priceLabel}</strong>
                    <span>{t('Common.monthly')}</span>
                  </div>
                </header>
                <div className="listing-showcase__gallery">
                  {images.map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      className={
                        item.id === coverId
                          ? 'listing-showcase__shot is-cover'
                          : 'listing-showcase__shot'
                      }
                      onClick={() => setPreviewId(item.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt="" />
                      {index === 0 || item.id === coverId ? (
                        <span>{t('PropertyForm.coverImage')}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="listing-showcase__grid">
                  <section className="listing-showcase__panel">
                    <h3>{t('Property.details')}</h3>
                    <dl className="detail-facts">
                      <div>
                        <dt>{t('PropertyForm.code')}</dt>
                        <dd dir="ltr">U-01</dd>
                      </div>
                      <div>
                        <dt>{t('PropertyForm.floor')}</dt>
                        <dd>{primary.floor || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('Property.beds')}</dt>
                        <dd>{primary.bedrooms || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('Property.baths')}</dt>
                        <dd>{primary.bathrooms || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('PropertyForm.majlis')}</dt>
                        <dd>{primary.majlis || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('PropertyForm.halls')}</dt>
                        <dd>{primary.halls || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('PropertyForm.kitchens')}</dt>
                        <dd>{primary.kitchens || '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('PropertyForm.hasPool')}</dt>
                        <dd>
                          {primary.hasPool === 'true'
                            ? t('PropertyForm.poolAvailable')
                            : primary.hasPool === 'false'
                              ? t('PropertyForm.poolUnavailable')
                              : '—'}
                        </dd>
                      </div>
                      {primary.area ? (
                        <div>
                          <dt>{t('Property.area')}</dt>
                          <dd>
                            {primary.area} m²
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{t('PropertyForm.category')}</dt>
                        <dd>
                          {
                            (
                              {
                                apartment: t('PropertyForm.categoryApartment'),
                                villa: t('PropertyForm.categoryVilla'),
                                building: t('PropertyForm.categoryBuilding'),
                                office: t('PropertyForm.categoryOffice'),
                                shop: t('PropertyForm.categoryShop'),
                                warehouse: t('PropertyForm.categoryWarehouse'),
                                land: t('PropertyForm.categoryLand'),
                                other: t('PropertyForm.categoryOther'),
                              } as Record<string, string>
                            )[property.category]
                          }
                        </dd>
                      </div>
                    </dl>
                    <p>
                      {locale === 'ar'
                        ? property.descriptionAr || '—'
                        : property.descriptionEn || '—'}
                    </p>
                  </section>
                  <aside className="listing-showcase__aside">
                    <div className="listing-showcase__book">
                      <p>{t('Property.available')}</p>
                      <h3>
                        {priceLabel} <small>{t('Common.monthly')}</small>
                      </h3>
                      <p className="field__hint">{t('PropertyForm.listingPreviewCta')}</p>
                    </div>
                    {mapCoords ? (
                      <iframe
                        title={t('PropertyForm.mapsPreview')}
                        className="maps-preview__frame"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={googleMapsEmbedSrc(mapCoords.latitude, mapCoords.longitude)}
                      />
                    ) : null}
                  </aside>
                </div>
                <section className="listing-showcase__amenities">
                  <h3>{t('PropertyForm.amenitiesLegend')}</h3>
                  <div className="amenity-picker__grid">
                    {amenityOptions
                      .filter(([code]) => amenities.includes(code))
                      .map(([code, labelAr, labelEn, icon]) => (
                        <div className="amenity-chip is-selected" key={code}>
                          <span className="amenity-chip__icon" aria-hidden="true">
                            {icon}
                          </span>
                          <span>{ar ? labelAr : labelEn}</span>
                        </div>
                      ))}
                    {!amenities.length ? (
                      <p className="field__hint">{ar ? 'لم تُختر مرافق بعد.' : 'No amenities selected yet.'}</p>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}
              </div>
            </div>

            {error ? (
              <div className="notice notice--error" role="alert">
                <p>{error}</p>
                {/Render|health\/ready|DATABASE_URL|api_unreachable|تعذر الوصول إلى/i.test(error) ? (
                  <div style={{ marginTop: '0.75rem' }}>
                    <NestReconnectButton locale={locale === 'en' ? 'en' : 'ar'} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {success ? (
              <div className="notice notice--success" role="status">
                {success}
              </div>
            ) : null}

            <div className="wizard-footer form-actions">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => goToStep(step - 1)}
                  disabled={busy}
                >
                  {t('Common.back')}
                </Button>
              ) : (
                <span />
              )}
              <div className="wizard-footer__primary">
                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={(event) => void submit(event as unknown as FormEvent<HTMLFormElement>, true)}
                >
                  {busy ? t('Common.saving') : t('PropertyForm.saveDraft')}
                </Button>
                {step < steps.length - 1 ? (
                  <Button type="submit">{t('Common.continue')}</Button>
                ) : (
                  <Button type="submit" disabled={busy}>
                    {busy ? t('Common.saving') : t('PropertyForm.submit')}
                  </Button>
                )}
              </div>
            </div>
            <input type="hidden" name="portal" value={portal} />
          </form>
        </CardContent>
      </Card>

      {mapPickerOpen ? (
        <MapLocationPicker
          open={mapPickerOpen}
          locale={locale}
          initial={mapCoords}
          onClose={() => setMapPickerOpen(false)}
          onConfirm={(coords, mapsUrl) => {
            applyMapsCoords(coords.latitude, coords.longitude, mapsUrl);
            setMapPickerOpen(false);
          }}
          labels={{
            title: t('PropertyForm.pickOnMapTitle'),
            hint: t('PropertyForm.pickOnMapHint'),
            searchPlaceholder: t('PropertyForm.pickOnMapSearch'),
            search: t('PropertyForm.pickOnMapSearchBtn'),
            confirm: t('PropertyForm.pickOnMapConfirm'),
            cancel: t('Common.back'),
            coords: t('PropertyForm.pickOnMapCoords'),
          }}
        />
      ) : null}

      {previewId ? (
        <div className="wizard-lightbox" role="dialog" aria-modal="true">
          <button
            type="button"
            className="wizard-lightbox__backdrop"
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={() => setPreviewId(null)}
          />
          <div className="wizard-lightbox__panel">
            {(() => {
              const img =
                images.find((i) => i.id === previewId) ??
                units.flatMap((unit) => unit.images).find((i) => i.id === previewId);
              const doc = documents.find((d) => d.id === previewId);
              if (img)
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.file?.name || (ar ? 'صورة' : 'Image')} />
                );
              if (doc?.kind === 'pdf' && doc.url)
                return (
                  <iframe
                    title={doc.file?.name || doc.label || 'PDF'}
                    src={doc.url}
                    className="wizard-lightbox__pdf"
                  />
                );
              if (doc?.url)
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={doc.url} alt={doc.file?.name || doc.label || ''} />
                );
              if (doc?.existing)
                return (
                  <p className="muted">
                    {ar
                      ? 'مستند محفوظ مسبقاً — اختر ملفاً جديداً للاستبدال.'
                      : 'Previously saved document — choose a new file to replace it.'}
                  </p>
                );
              return null;
            })()}
            <Button type="button" onClick={() => setPreviewId(null)}>
              {ar ? 'إغلاق' : 'Close'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
