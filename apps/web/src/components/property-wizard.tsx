'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, Field, SelectField, TextAreaField } from '@bhd-r/ui';
import { supportedCurrencyCodes, type CurrencyCode } from '@bhd-r/contracts';
import { countryPacks, type CountryPackCode } from '@bhd-r/country-packs';
import { useLocale, useTranslations } from 'next-intl';
import { browserMediaPut, browserMutation, mapWithConcurrency } from '@/lib/api';
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

interface UnitDraft {
  localId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
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

type MediaItem = { id: string; file: File; url: string };
type PrivateDocType = 'title_deed' | 'floor_plan' | 'other';
type DocItem = {
  id: string;
  file: File;
  url: string;
  kind: 'pdf' | 'image';
  documentType: PrivateDocType;
};

const blankUnit = (index: number): UnitDraft => ({
  localId: crypto.randomUUID(),
  code: `U-${String(index).padStart(2, '0')}`,
  nameAr: '',
  nameEn: '',
  floor: '',
  bedrooms: '',
  bathrooms: '',
  area: '',
  listingPurpose: 'rent',
  rent: '',
  salePrice: '',
  deposit: '',
  publishWhenAvailable: false,
});

const BEDROOM_OPTIONS = Array.from({ length: 16 }, (_, i) => String(i)); // 0–15
const BATHROOM_OPTIONS = Array.from({ length: 11 }, (_, i) => String(i)); // 0–10
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
  portal,
}: {
  ownerPartyId: string;
  portal: 'owner' | 'developer';
}) {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const ar = locale === 'ar';
  const [step, setStep] = useState(0);
  const [slideDir, setSlideDir] = useState<'forward' | 'back'>('forward');
  const [maxReached, setMaxReached] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [missingHints, setMissingHints] = useState<string[]>([]);
  const [kind, setKind] = useState<'single_unit' | 'multi_unit'>('single_unit');
  const [currency, setCurrency] = useState<CurrencyCode>('OMR');
  const [property, setProperty] = useState({
    countryCode: 'OM' as CountryPackCode,
    category: 'apartment',
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    descriptionEn: '',
    governorate: '',
    wilayat: '',
    city: '',
    area: '',
    street: '',
    mapsUrl: '',
    latitude: '',
    longitude: '',
  });
  const [units, setUnits] = useState<UnitDraft[]>([blankUnit(1)]);
  const [profile, setProfile] = useState({
    deedNumber: '',
    plotNumber: '',
    municipalityNumber: '',
    landArea: '',
    builtUpArea: '',
    yearBuilt: '',
    parkingSpaces: '',
    furnishing: 'unfurnished' as 'unfurnished' | 'semi_furnished' | 'furnished',
    managementStartedOn: '',
    managementFee: '',
    electricityMeter: '',
    waterMeter: '',
    insuranceNumber: '',
    insuranceExpiresOn: '',
    notes: '',
  });
  const [amenities, setAmenities] = useState<string[]>([]);
  const [customAmenities, setCustomAmenities] = useState<
    Array<{ code: string; labelAr: string; labelEn: string }>
  >([]);
  const [customDraft, setCustomDraft] = useState({ ar: '', en: '' });
  const [images, setImages] = useState<MediaItem[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [busy, setBusy] = useState(false);
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
      images.forEach((item) => URL.revokeObjectURL(item.url));
      documents.forEach((item) => URL.revokeObjectURL(item.url));
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
        if (unit.listingPurpose !== 'sale' && !unit.rent.trim())
          issues.push(`${label}: ${t('PropertyForm.rent')}`);
        if (unit.listingPurpose !== 'rent' && !unit.salePrice.trim())
          issues.push(`${label}: ${t('PropertyForm.salePrice')}`);
      });
    }
    if (index === 4) {
      if (images.length < 2) issues.push(t('PropertyForm.imagesMinTwo'));
      const bad = images.some(
        (item) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(item.file.type) ||
          item.file.size > 10 * 1024 * 1024,
      );
      if (bad) issues.push(t('PropertyForm.imageHelp'));
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

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const accepted: MediaItem[] = [];
    let rejected = false;
    for (const file of files) {
      if (!allowed.has(file.type) || file.size > 10 * 1024 * 1024) {
        rejected = true;
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      });
    }
    if (!accepted.length) {
      setError(t('PropertyForm.imageHelp'));
      return;
    }

    setImages((current) => {
      const room = Math.max(0, 12 - current.length);
      if (room === 0) {
        accepted.forEach((item) => URL.revokeObjectURL(item.url));
        return current;
      }
      const toAdd = accepted.slice(0, room);
      accepted.slice(room).forEach((item) => URL.revokeObjectURL(item.url));
      return [...current, ...toAdd];
    });
    setCoverId((current) => current ?? accepted[0]?.id ?? null);
    setError(
      rejected
        ? t('PropertyForm.imageHelp')
        : null,
    );
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
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
      if (previous) URL.revokeObjectURL(previous.url);
      return [...current.filter((item) => item.documentType !== documentType), next];
    });
  }

  function removeDocument(documentType: PrivateDocType) {
    setDocuments((current) => {
      const previous = current.find((item) => item.documentType === documentType);
      if (previous) URL.revokeObjectURL(previous.url);
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
    const intent = await browserMutation<UploadIntent>('/v1/media/upload-intents', {
      method: 'POST',
      body: JSON.stringify({
        purpose,
        unitId,
        mimeType: file.type,
        byteSize: file.size,
      }),
    });
    try {
      await browserMediaPut(intent, file);
    } catch (error) {
      const hint = ar
        ? `تعذر رفع الملف (${file.name}). تأكد من اتصال الخادم ثم أعد المحاولة.`
        : `Could not upload ${file.name}. Check API connectivity and retry.`;
      throw error instanceof Error && error.message
        ? new Error(`${hint} (${error.message})`)
        : new Error(hint);
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
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
    setSuccess(ar ? 'جاري التحقق من اتصال Nest…' : 'Checking Nest connection…');
    try {
      // Fail fast — do not wait for Render cold-start (can exceed 1–3 minutes).
      const warmPayload = await Promise.race([
        fetch('/api/warm', { cache: 'no-store' })
          .then(async (warm) => {
            const body = (await warm.json().catch(() => null)) as {
              ok?: boolean;
              status?: number;
            } | null;
            return body;
          })
          .catch(() => null),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 8_000);
        }),
      ]);
      if (!warmPayload?.ok) {
        throw new Error(
          ar
            ? 'خادم Nest على Render غير متاح الآن. من لوحة Render أعد تشغيل/نشر الخدمة حتى تصبح Live، ثم افتح /health/ready وأعد الحفظ.'
            : 'Nest on Render is unavailable. Redeploy/restart the service until Live, verify /health/ready, then save again.',
        );
      }
      setSuccess(ar ? 'جاري حفظ العقار…' : 'Saving property…');
      const amenityPayload = amenities.map((code) => {
        const option = amenityOptions.find(([value]) => value === code)!;
        return { code, labelAr: option[1], labelEn: option[2] };
      });
      const createdProperty = await browserMutation<CreatedPropertyBundle>(
        '/v1/portfolio/properties',
        {
          method: 'POST',
          headers: { 'idempotency-key': bundleIdempotencyKey.current },
          body: JSON.stringify({
            property: {
              ownerPartyId,
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
              return {
                code: autoCode,
                nameAr: names.nameAr,
                nameEn: names.nameEn,
                floor: unit.floor || undefined,
                bedrooms: Number(unit.bedrooms),
                bathrooms: Number(unit.bathrooms),
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
          }),
        },
      );
      const mediaUnitId = createdProperty.units[0]?.id;
      if ((images.length > 0 || documents.length > 0) && !mediaUnitId)
        throw new Error('missing_media_unit');
      if (mediaUnitId) {
        const ordered = [
          ...images.filter((item) => item.id === coverId),
          ...images.filter((item) => item.id !== coverId),
        ];
        const imageJobs = ordered.map((item, position) => ({
          file: item.file,
          purpose: 'property_image' as const,
          position,
        }));
        const docJobs = documents
          .filter((doc) =>
            ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(doc.file.type),
          )
          .map((doc, index) => ({
            file: doc.file,
            purpose: 'attachment' as const,
            position: imageJobs.length + index,
          }));
        const jobs = [...imageJobs, ...docJobs];
        setSuccess(
          ar
            ? `جاري رفع الملفات (${jobs.length})…`
            : `Uploading media (${jobs.length})…`,
        );
        await mapWithConcurrency(jobs, 3, async (job) => {
          await uploadFile(job.file, mediaUnitId, job.purpose, job.position);
        });
      }
      bundleIdempotencyKey.current = `property-bundle:${crypto.randomUUID()}`;
      const serial = createdProperty.serialNumber;
      setSuccess(
        serial
          ? ar
            ? `تم الحفظ. الرقم المتسلسل للعقار: ${serial}`
            : `Saved. Property serial: ${serial}`
          : t('PropertyForm.success'),
      );
    } catch (caught) {
      setSuccess(null);
      setError(caught instanceof Error ? caught.message : 'request_failed');
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
        <p className="wizard-hero__kicker">{ar ? 'بوابة المالك' : 'Owner portal'}</p>
        <h1>{t('PropertyForm.title')}</h1>
        <p>{t('PropertyForm.intro')}</p>
        <div className="wizard-hero__meta" aria-hidden="true">
          <span>
            {ar ? 'المرحلة' : 'Step'} {step + 1} / {steps.length}
          </span>
          <span className="wizard-hero__bar">
            <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
      </header>

      <nav className="wizard-progress" aria-label={t('PropertyForm.wizardStepsAria')}>
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
                        }}
                      />
                      {t('PropertyForm.single')}
                    </label>
                    <label className={kind === 'multi_unit' ? 'wizard-seg__item is-active' : 'wizard-seg__item'}>
                      <input
                        type="radio"
                        name="kind"
                        checked={kind === 'multi_unit'}
                        onChange={() => setKind('multi_unit')}
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
                  onChange={(event) => updateProperty('category', event.target.value)}
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
                  onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
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
                        onChange={(event) => updateProperty('city', event.target.value)}
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
                                <small>{current.file.name}</small>
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
                  <p>{t('PropertyForm.imagesMinTwo')}</p>
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
                          onClick={() => removeImage(item.id)}
                        >
                          {t('PropertyForm.removeImage')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {images.length >= 12 ? (
                  <p className="field__hint">{t('PropertyForm.imagesMaxReached')}</p>
                ) : null}
                {showErrors && images.length < 2 ? (
                  <p className="field__error" role="alert">
                    {t('PropertyForm.imagesMinTwo')}
                  </p>
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
                {/Nest|Render|health\/ready/i.test(error) ? (
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
                  <img src={img.url} alt={img.file.name} />
                );
              if (doc?.kind === 'pdf')
                return <iframe title={doc.file.name} src={doc.url} className="wizard-lightbox__pdf" />;
              if (doc)
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={doc.url} alt={doc.file.name} />
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
