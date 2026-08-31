'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, Field, SelectField, TextAreaField } from '@bhd-r/ui';
import { supportedCurrencyCodes, currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { countryPacks, type CountryPackCode } from '@bhd-r/country-packs';
import { useLocale, useTranslations } from 'next-intl';
import { browserMediaPut, browserMutation, clearBrowserCsrfCache, fetchBrowserCsrfToken, mapWithConcurrency } from '@/lib/api';
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

interface UnitDraft {
  localId: string;
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
}

interface CreatedPropertyBundle {
  id: string;
  serialNumber?: string;
  units: Array<{ id: string }>;
}
interface UploadIntent {
  assetId: string;
  uploadUrl: string;
  uploadPath?: string;
  requiredHeaders?: Record<string, string>;
}

type MediaItem = { id: string; file?: File; url: string; existing?: boolean };
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

const blankUnit = (index: number): UnitDraft => ({
  localId: crypto.randomUUID(),
  code: `U-${String(index).padStart(2, '0')}`,
  nameAr: '',
  nameEn: '',
  floor: '',
  bedrooms: '',
  bathrooms: '',
  majlis: '',
  halls: '',
  kitchens: '',
  hasPool: '',
  area: '',
  listingPurpose: 'rent',
  rent: '',
  salePrice: '',
  deposit: '',
  publishWhenAvailable: false,
});

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
      return initialProperty.units.map((unit, index) => ({
        localId: unit.id,
        code: unit.code || `U-${String(index + 1).padStart(2, '0')}`,
        nameAr: unit.nameAr,
        nameEn: unit.nameEn,
        floor: unit.floor ?? '',
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
      }));
    }
    return [blankUnit(1)];
  });
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
    // Warm Nest (Render cold start) before the user hits save.
    void fetch('/api/warm', { cache: 'no-store' }).catch(() => undefined);
    void fetch('/api/backend/v1/auth/csrf', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).catch(() => undefined);
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
      setError(ar ? 'تعذّرت الترجمة حالياً. حاول مرة أخرى.' : 'Translation failed. Please try again.');
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
    return {
      nameAr: `${property.nameAr.trim()} (${code})`,
      nameEn: `${property.nameEn.trim()} (${code})`,
    };
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
    }
    if (index === 1) {
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

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

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
      setError(
        rejectedHeic
          ? t('PropertyForm.imageHeicHelp')
          : t('PropertyForm.imageHelp'),
      );
      return;
    }

    setImages((current) => {
      const room = Math.max(0, 12 - current.length);
      if (room === 0) {
        accepted.forEach((item) => revokeIfBlob(item.url));
        return current;
      }
      const toAdd = accepted.slice(0, room);
      accepted.slice(room).forEach((item) => revokeIfBlob(item.url));
      return [...current, ...toAdd];
    });
    setCoverId((current) => current ?? accepted[0]?.id ?? null);
    setShowErrors(false);
    setMissingHints([]);
    setError(
      rejectedHeic
        ? t('PropertyForm.imageHeicHelp')
        : rejectedOther
          ? t('PropertyForm.imageHelp')
          : null,
    );

    // Compress in the background so later upload is smaller/faster.
    void (async () => {
      for (const item of accepted.slice(0, Math.max(0, 12))) {
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
      }
    })();
  }

  async function removeImage(id: string) {
    const target = images.find((item) => item.id === id);
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
      category: property.category,
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
      area: primary.area || profile.builtUpArea,
      listingPurpose: primary.listingPurpose,
      furnishing: profile.furnishing,
      amenities: amenityPayload,
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

    // Prefer Vercel→R2→Neon (same as property save) so Render cold starts don't drop photos.
    const form = new FormData();
    form.append('file', prepared);
    form.append('unitId', unitId);
    form.append('purpose', purpose);
    form.append('position', String(position ?? 0));
    const csrf = await fetchBrowserCsrfToken();
    const vercelUpload = await fetch('/api/owner/media', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrf },
      body: form,
      signal: AbortSignal.timeout(55_000),
    });
    if (vercelUpload.ok) return;
    const vercelError = (await vercelUpload.json().catch(() => null)) as {
      error?: { code?: string; message?: string; messageAr?: string };
    } | null;
    if (vercelUpload.status !== 503) {
      throw new Error(
        vercelError?.error?.messageAr ??
          vercelError?.error?.message ??
          `upload_failed:${vercelUpload.status}`,
      );
    }

    const intent = await browserMutation<UploadIntent>('/v1/media/upload-intents', {
      method: 'POST',
      body: JSON.stringify({
        purpose,
        unitId,
        mimeType: prepared.type,
        byteSize: prepared.size,
      }),
    });
    try {
      await browserMediaPut(intent, prepared);
    } catch (error) {
      const hint = ar
        ? `تعذر رفع الملف (${prepared.name}). تأكد من اتصال الخادم ثم أعد المحاولة.`
        : `Could not upload ${prepared.name}. Check API connectivity and retry.`;
      throw error instanceof Error && error.message
        ? new Error(`${hint} (${error.message})`)
        : new Error(hint);
    }
    const digest = await crypto.subtle.digest('SHA-256', await prepared.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    await browserMutation(`/v1/media/${intent.assetId}/complete`, {
      method: 'POST',
      headers: { 'idempotency-key': `media-complete:${intent.assetId}` },
      body: JSON.stringify({
        sha256,
        unitId,
        ...(position === undefined ? {} : { position }),
      }),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < steps.length - 1) {
      goToStep(step + 1);
      return;
    }
    const issues = [...validateStep(0), ...validateStep(1), ...validateStep(4)];
    if (issues.length) {
      setShowErrors(true);
      setMissingHints(issues);
      setError(t('PropertyForm.fixBeforeSave'));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(ar ? 'جاري حفظ العقار…' : 'Saving property…');
    try {
      const amenityPayload = amenities.map((code) => {
        const option = amenityOptions.find(([value]) => value === code)!;
        return { code, labelAr: option[1], labelEn: option[2] };
      });
      const payload = {
            property: {
              ownerPartyId: selectedOwnerPartyId,
              kind,
              category: property.category,
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
            units: units.map((unit, index) => {
              const names = unitDisplayNames(unit);
              const autoCode = `U-${String(index + 1).padStart(2, '0')}`;
              const unitId =
                mode === 'edit' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                  unit.localId,
                )
                  ? unit.localId
                  : undefined;
              return {
                ...(unitId ? { id: unitId } : {}),
                code: autoCode,
                nameAr: names.nameAr,
                nameEn: names.nameEn,
                floor: unit.floor || undefined,
                bedrooms: Number(unit.bedrooms),
                bathrooms: Number(unit.bathrooms),
                majlis: Number(unit.majlis),
                halls: Number(unit.halls),
                kitchens: Number(unit.kitchens),
                hasPool: unit.hasPool === 'true',
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
                publishWhenAvailable: unit.publishWhenAvailable,
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

        let csrfToken = await fetchBrowserCsrfToken();
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
        const mediaUnitId = updated.units?.[0]?.id ?? initialProperty?.units[0]?.id;
        let mediaWarning: string | null = null;
        const newImages = images.filter((item) => item.file);
        const newDocs = documents.filter((doc) => doc.file);
        if ((newImages.length > 0 || newDocs.length > 0) && mediaUnitId) {
          try {
            const ordered = [
              ...newImages.filter((item) => item.id === coverId),
              ...newImages.filter((item) => item.id !== coverId),
            ];
            const imageJobs = ordered.map((item, position) => ({
              file: item.file!,
              purpose: 'property_image' as const,
              position,
            }));
            const docJobs = newDocs.map((doc, index) => ({
              file: doc.file!,
              purpose: 'attachment' as const,
              position: imageJobs.length + index,
            }));
            const jobs = [...imageJobs, ...docJobs];
            if (jobs.length) {
              setSuccess(
                ar
                  ? `جاري رفع الملفات الجديدة (${jobs.length})…`
                  : `Uploading new media (${jobs.length})…`,
              );
              await mapWithConcurrency(jobs, 3, async (job) => {
                await uploadFile(job.file, mediaUnitId, job.purpose, job.position);
              });
            }
          } catch (mediaError) {
            mediaWarning = ar
              ? `تم تحديث العقار، لكن رفع الصور فشل: ${mediaError instanceof Error ? mediaError.message : 'خطأ غير معروف'}. أعد رفع الصور من التعديل.`
              : `Property updated, but photo upload failed: ${mediaError instanceof Error ? mediaError.message : 'unknown error'}. Re-upload from edit.`;
          }
        }
        setSuccess(
          mediaWarning ?? (ar ? 'تم تحديث بيانات العقار' : 'Property updated'),
        );
        if (mediaWarning) {
          setError(mediaWarning);
          setBusy(false);
          return;
        }
        goToPropertyPage(locale, portal, propertyId);
        return;
      }

      let createdProperty: CreatedPropertyBundle;
      const neonResponse = await fetch('/api/owner/properties', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': bundleIdempotencyKey.current,
          'x-csrf-token': await fetchBrowserCsrfToken(),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55_000),
      });
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
      const mediaUnitId = createdProperty.units[0]?.id;
      let mediaWarning: string | null = null;
      if ((images.length > 0 || documents.length > 0) && mediaUnitId) {
        try {
          const ordered = [
            ...images.filter((item) => item.file && item.id === coverId),
            ...images.filter((item) => item.file && item.id !== coverId),
          ];
          const imageJobs = ordered.map((item, position) => ({
            file: item.file!,
            purpose: 'property_image' as const,
            position,
          }));
          const docJobs = documents
            .filter(
              (doc) =>
                doc.file &&
                ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(
                  doc.file.type,
                ),
            )
            .map((doc, index) => ({
              file: doc.file!,
              purpose: 'attachment' as const,
              position: imageJobs.length + index,
            }));
          const jobs = [...imageJobs, ...docJobs];
          if (jobs.length) {
            setSuccess(
              ar
                ? `جاري رفع الملفات (${jobs.length})…`
                : `Uploading media (${jobs.length})…`,
            );
            await mapWithConcurrency(jobs, 3, async (job) => {
              await uploadFile(job.file, mediaUnitId, job.purpose, job.position);
            });
          }
        } catch (mediaError) {
          mediaWarning = ar
            ? `تم حفظ العقار، لكن رفع الصور فشل: ${mediaError instanceof Error ? mediaError.message : 'خطأ غير معروف'}. افتح التعديل وأعد رفع الصور.`
            : `Property saved, but photo upload failed: ${mediaError instanceof Error ? mediaError.message : 'unknown error'}. Open edit and re-upload photos.`;
        }
      }
      const serial = createdProperty.serialNumber;
      setSuccess(
        mediaWarning ??
          (serial
            ? ar
              ? `تم الحفظ. الرقم المتسلسل للعقار: ${serial}`
              : `Saved. Property serial: ${serial}`
            : t('PropertyForm.success')),
      );
      if (mediaWarning) {
        setError(mediaWarning);
        setBusy(false);
        window.location.assign(
          `/${locale}/${portal}/properties/${encodeURIComponent(createdProperty.id)}/edit`,
        );
        return;
      }
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
                          setUnits((current) => [current[0] ?? blankUnit(1)]);
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
                          focusNextField();
                        }}
                      />
                      {t('PropertyForm.multi')}
                    </label>
                  </div>
                </div>
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
                  value={property.category}
                  tone={tone(property.category, true, showErrors)}
                  onChange={(event) =>
                    onSelectAdvance(event, (value) => updateProperty('category', value))
                  }
                  required
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
                {units.map((unit, index) => (
                  <fieldset className="unit-editor" key={unit.localId}>
                    <legend className="sr-only">
                      {t('PropertyForm.unit')} {index + 1}
                    </legend>
                    <div className="unit-editor__head">
                      <h3>
                        {t('PropertyForm.unit')} {index + 1}
                      </h3>
                      {kind === 'multi_unit' && units.length > 1 ? (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() =>
                            setUnits((current) =>
                              current.filter((item) => item.localId !== unit.localId),
                            )
                          }
                        >
                          {t('PropertyForm.removeUnit')}
                        </Button>
                      ) : null}
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
                        onChange={(event) => updateUnit(unit.localId, 'floor', event.target.value)}
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
                        onChange={(event) => updateUnit(unit.localId, 'halls', event.target.value)}
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
                        onChange={(event) => updateUnit(unit.localId, 'area', event.target.value)}
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
                        onChange={(event) => updateUnit(unit.localId, 'rent', event.target.value)}
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
                              updateUnit(unit.localId, 'publishWhenAvailable', event.target.checked)
                            }
                          />
                          {t('PropertyForm.publish')}
                        </label>
                        <p className="field__hint">{t('PropertyForm.publishHint')}</p>
                      </div>
                    </div>
                  </fieldset>
                ))}
                {kind === 'multi_unit' ? (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setUnits((current) => [...current, blankUnit(current.length + 1)])
                    }
                  >
                    ＋ {t('PropertyForm.addUnit')}
                  </Button>
                ) : null}
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
                    label={ar ? 'المساحة المبنية (م²)' : 'Built-up area (m²)'}
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
                <label htmlFor="property-images" className="upload-zone__label">
                  <strong>{t('PropertyForm.images')}</strong>
                  <p>{t('PropertyForm.imagesOptional')}</p>
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
                {/Nest|Render|health\/ready|DATABASE_URL|Vercel/i.test(error) ? (
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
              {step < steps.length - 1 ? (
                <Button type="submit">{t('Common.continue')}</Button>
              ) : (
                <Button type="submit" disabled={busy}>
                  {busy ? t('Common.saving') : t('PropertyForm.submit')}
                </Button>
              )}
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
              const img = images.find((i) => i.id === previewId);
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
