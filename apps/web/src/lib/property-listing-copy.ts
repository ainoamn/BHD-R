/** Bilingual copy + translation helpers for the property wizard. */

const categoryLabels: Record<string, { ar: string; en: string }> = {
  apartment: { ar: 'شقة', en: 'apartment' },
  villa: { ar: 'فيلا', en: 'villa' },
  building: { ar: 'مبنى', en: 'building' },
  office: { ar: 'مكتب', en: 'office' },
  shop: { ar: 'محل تجاري', en: 'shop' },
  warehouse: { ar: 'مستودع', en: 'warehouse' },
  land: { ar: 'أرض', en: 'land plot' },
  other: { ar: 'عقار', en: 'property' },
};

const amenityPhrase: Record<string, { ar: string; en: string }> = {
  parking: { ar: 'مواقف سيارات', en: 'parking' },
  elevator: { ar: 'مصعد', en: 'elevator' },
  security: { ar: 'حراسة', en: 'security' },
  cctv: { ar: 'كاميرات مراقبة', en: 'CCTV' },
  pool: { ar: 'مسبح', en: 'swimming pool' },
  gym: { ar: 'نادي صحي', en: 'gym' },
  garden: { ar: 'حديقة', en: 'garden' },
  central_ac: { ar: 'تكييف مركزي', en: 'central AC' },
  accessible: { ar: 'إمكانية وصول لذوي الإعاقة', en: 'accessibility features' },
  fire_system: { ar: 'نظام إطفاء حريق', en: 'fire safety system' },
  balcony: { ar: 'شرفة', en: 'balcony' },
  maid_room: { ar: 'غرفة خادمة', en: 'maid room' },
  storage: { ar: 'مخزن', en: 'storage' },
  laundry: { ar: 'غسيل ملابس', en: 'laundry' },
  wifi: { ar: 'إنترنت', en: 'Wi‑Fi' },
  kids_area: { ar: 'منطقة أطفال', en: 'kids area' },
  mosque_nearby: { ar: 'قرب المسجد', en: 'nearby mosque' },
  school_nearby: { ar: 'قرب المدارس', en: 'nearby schools' },
  sea_view: { ar: 'إطلالة بحرية', en: 'sea view' },
  mountain_view: { ar: 'إطلالة جبلية', en: 'mountain view' },
  furnished_kit: { ar: 'مطبخ مجهّز', en: 'equipped kitchen' },
  smart_home: { ar: 'منزل ذكي', en: 'smart home' },
};

/** Exact bilingual lexicon (longest keys first) for offline/name fallback. */
const LEXICON: Array<[string, string]> = [
  ['مبنى فاخر', 'Luxury building'],
  ['شقة فاخرة', 'Luxury apartment'],
  ['فيلا فاخرة', 'Luxury villa'],
  ['سلطنة عُمان', 'Sultanate of Oman'],
  ['سلطنة عمان', 'Sultanate of Oman'],
  ['مواقف سيارات', 'parking spaces'],
  ['تكييف مركزي', 'central air conditioning'],
  ['نظام إطفاء حريق', 'fire safety system'],
  ['غرفة خادمة', 'maid room'],
  ['منطقة أطفال', 'kids area'],
  ['قرب المسجد', 'near the mosque'],
  ['قرب المدارس', 'near schools'],
  ['إطلالة بحرية', 'sea view'],
  ['إطلالة جبلية', 'mountain view'],
  ['مطبخ مجهّز', 'equipped kitchen'],
  ['منزل ذكي', 'smart home'],
  ['للإيجار أو البيع', 'for rent or sale'],
  ['غير مؤثثة', 'unfurnished'],
  ['شبه مؤثثة', 'semi-furnished'],
  ['مؤثثة بالكامل', 'fully furnished'],
  ['غرف النوم', 'bedrooms'],
  ['الحمامات', 'bathrooms'],
  ['المجالس', 'majlis'],
  ['الصالات', 'halls'],
  ['المطابخ', 'kitchens'],
  ['حوض سباحة', 'swimming pool'],
  ['مبنى', 'building'],
  ['شقة', 'apartment'],
  ['فيلا', 'villa'],
  ['مكتب', 'office'],
  ['محل', 'shop'],
  ['مستودع', 'warehouse'],
  ['أرض', 'land'],
  ['عقار', 'property'],
  ['للإيجار', 'for rent'],
  ['للبيع', 'for sale'],
  ['مسقط', 'Muscat'],
  ['ظفار', 'Dhofar'],
  ['صلالة', 'Salalah'],
  ['صحار', 'Sohar'],
  ['نزوى', 'Nizwa'],
  ['بوشر', 'Bausher'],
  ['السيب', 'Seeb'],
  ['الخوير', 'Al Khuwair'],
  ['القرم', 'Qurum'],
  ['العذيبة', 'Azaiba'],
  ['الغبرة', 'Al Ghubrah'],
  ['المعبيلة', 'Mabela'],
  ['فاخر', 'luxury'],
  ['فاخرة', 'luxury'],
  ['مواقف', 'parking'],
  ['مصعد', 'elevator'],
  ['حراسة', 'security'],
  ['مسبح', 'swimming pool'],
  ['حديقة', 'garden'],
  ['شرفة', 'balcony'],
  ['مخزن', 'storage'],
  ['إنترنت', 'internet'],
];

export type DescriptionInput = {
  nameAr: string;
  nameEn: string;
  category: string;
  governorate: string;
  wilayat: string;
  village: string;
  street?: string;
  bedrooms: number;
  bathrooms: number;
  majlis?: number | undefined;
  halls?: number | undefined;
  kitchens?: number | undefined;
  hasPool?: boolean | undefined;
  area?: string | undefined;
  listingPurpose: 'rent' | 'sale' | 'both';
  furnishing: string;
  amenities: Array<{ code: string; labelAr: string; labelEn: string }>;
  /** When set, generates a multi-unit building description instead of a single-unit one. */
  multiUnit?:
    | {
        shopCount: number;
        showroomCount: number;
        apartmentCount: number;
        totalArea?: string | undefined;
        yearBuilt?: number | string | undefined;
      }
    | undefined;
};

function roomDetailsAr(input: DescriptionInput): string | null {
  const parts: string[] = [];
  if (input.bedrooms > 0) parts.push(`${input.bedrooms} غرفة نوم`);
  if (input.bathrooms > 0) parts.push(`${input.bathrooms} حمّام`);
  if ((input.majlis ?? 0) > 0) parts.push(`${input.majlis} مجلس`);
  if ((input.halls ?? 0) > 0) parts.push(`${input.halls} صالة`);
  if ((input.kitchens ?? 0) > 0) parts.push(`${input.kitchens} مطبخ`);
  if (input.hasPool === true) parts.push('حوض سباحة متوفر');
  else if (input.hasPool === false) parts.push('بدون حوض سباحة');
  if (!parts.length && !input.area) return null;
  const rooms = parts.length ? `تضم ${parts.join(' و')}` : 'تفاصيل الوحدة';
  return `${rooms}${input.area ? `، بمساحة تقارب ${input.area} م²` : ''}.`;
}

function roomDetailsEn(input: DescriptionInput): string | null {
  const parts: string[] = [];
  if (input.bedrooms > 0) parts.push(`${input.bedrooms} bedroom(s)`);
  if (input.bathrooms > 0) parts.push(`${input.bathrooms} bathroom(s)`);
  if ((input.majlis ?? 0) > 0) parts.push(`${input.majlis} majlis`);
  if ((input.halls ?? 0) > 0) parts.push(`${input.halls} hall(s)/living room(s)`);
  if ((input.kitchens ?? 0) > 0) parts.push(`${input.kitchens} kitchen(s)`);
  if (input.hasPool === true) parts.push('a swimming pool');
  else if (input.hasPool === false) parts.push('no swimming pool');
  if (!parts.length && !input.area) return null;
  const rooms = parts.length ? `It features ${parts.join(', ')}` : 'Unit details';
  return `${rooms}${input.area ? `, approximately ${input.area} m²` : ''}.`;
}

function buildingAgePhrase(
  yearBuilt: number | string | undefined,
  locale: 'ar' | 'en',
): string | null {
  const year = typeof yearBuilt === 'string' ? Number(yearBuilt) : yearBuilt;
  if (!year || !Number.isFinite(year) || year < 1800 || year > 2200) return null;
  const age = Math.max(0, new Date().getFullYear() - year);
  if (locale === 'ar') {
    if (age <= 0) return `عمر البناء: جديد (بني عام ${year})`;
    if (age === 1) return `عمر البناء: سنة واحدة (بني عام ${year})`;
    if (age === 2) return `عمر البناء: سنتان (بني عام ${year})`;
    if (age >= 3 && age <= 10) return `عمر البناء: ${age} سنوات (بني عام ${year})`;
    return `عمر البناء: ${age} سنة (بني عام ${year})`;
  }
  return age <= 0
    ? `Building age: new (built ${year})`
    : `Building age: ${age} year${age === 1 ? '' : 's'} (built ${year})`;
}

function multiUnitCompositionAr(input: NonNullable<DescriptionInput['multiUnit']>): string {
  const parts: string[] = [];
  if (input.shopCount > 0) parts.push(`${input.shopCount} محل`);
  if (input.showroomCount > 0) parts.push(`${input.showroomCount} معرض`);
  if (input.apartmentCount > 0) parts.push(`${input.apartmentCount} شقة`);
  const total = input.shopCount + input.showroomCount + input.apartmentCount;
  if (!parts.length) return total ? `يضم ${total} وحدة.` : '';
  return `يتكون المبنى من ${parts.join(' و')} (إجمالي ${total} وحدة).`;
}

function multiUnitCompositionEn(input: NonNullable<DescriptionInput['multiUnit']>): string {
  const parts: string[] = [];
  if (input.shopCount > 0)
    parts.push(`${input.shopCount} shop${input.shopCount === 1 ? '' : 's'}`);
  if (input.showroomCount > 0)
    parts.push(`${input.showroomCount} showroom${input.showroomCount === 1 ? '' : 's'}`);
  if (input.apartmentCount > 0)
    parts.push(`${input.apartmentCount} apartment${input.apartmentCount === 1 ? '' : 's'}`);
  const total = input.shopCount + input.showroomCount + input.apartmentCount;
  if (!parts.length) return total ? `It contains ${total} unit(s).` : '';
  return `The building comprises ${parts.join(', ')} (${total} units in total).`;
}

export function generateListingDescriptions(input: DescriptionInput): {
  descriptionAr: string;
  descriptionEn: string;
} {
  const cat = categoryLabels[input.category] ?? categoryLabels.other!;
  const placeAr = [input.village, input.wilayat, input.governorate].filter(Boolean).join('، ');
  const placeEn = [input.village, input.wilayat, input.governorate]
    .filter(Boolean)
    .map((part) => lexiconTranslate(part, 'en'))
    .join(', ');
  const purposeAr =
    input.listingPurpose === 'sale'
      ? 'للبيع'
      : input.listingPurpose === 'both'
        ? 'للإيجار أو البيع'
        : 'للإيجار';
  const purposeEn =
    input.listingPurpose === 'sale'
      ? 'for sale'
      : input.listingPurpose === 'both'
        ? 'for rent or sale'
        : 'for rent';
  const amenAr = input.amenities
    .slice(0, 8)
    .map((a) => amenityPhrase[a.code]?.ar ?? a.labelAr)
    .filter(Boolean);
  const amenEn = input.amenities
    .slice(0, 8)
    .map((a) => amenityPhrase[a.code]?.en ?? a.labelEn)
    .filter(Boolean);

  const titleEn =
    input.nameEn.trim() || lexiconTranslate(input.nameAr, 'en') || cat.en;

  if (input.multiUnit) {
    const totalArea =
      input.multiUnit.totalArea?.trim() || input.area?.trim() || undefined;
    const ageAr = buildingAgePhrase(input.multiUnit.yearBuilt, 'ar');
    const ageEn = buildingAgePhrase(input.multiUnit.yearBuilt, 'en');
    const descriptionAr = [
      `مبنى متعدد الوحدات بعنوان «${input.nameAr || 'مبنى'}» ${purposeAr} في ${placeAr || 'سلطنة عُمان'}.`,
      ageAr ? `${ageAr}.` : null,
      totalArea ? `المساحة الإجمالية للمبنى تقارب ${totalArea} م².` : null,
      multiUnitCompositionAr(input.multiUnit),
      amenAr.length ? `من أبرز مميزات المبنى: ${amenAr.join('، ')}.` : null,
      input.street ? `يقع على ${input.street}.` : null,
      'فرصة استثمارية مناسبة، مع إدارة موثوقة عبر منصة BHD R.',
    ]
      .filter(Boolean)
      .join(' ');

    const descriptionEn = [
      `A multi-unit building titled “${titleEn}” ${purposeEn} in ${placeEn || 'the Sultanate of Oman'}.`,
      ageEn ? `${ageEn}.` : null,
      totalArea ? `Total building area is approximately ${totalArea} m².` : null,
      multiUnitCompositionEn(input.multiUnit),
      amenEn.length ? `Key building features: ${amenEn.join(', ')}.` : null,
      input.street ? `Located on ${input.street}.` : null,
      'A strong investment opportunity, professionally managed through BHD R.',
    ]
      .filter(Boolean)
      .join(' ');

    return { descriptionAr, descriptionEn };
  }

  const furnishAr =
    input.furnishing === 'furnished'
      ? 'مؤثثة بالكامل'
      : input.furnishing === 'semi_furnished'
        ? 'شبه مؤثثة'
        : 'غير مؤثثة';
  const furnishEn =
    input.furnishing === 'furnished'
      ? 'fully furnished'
      : input.furnishing === 'semi_furnished'
        ? 'semi-furnished'
        : 'unfurnished';

  const descriptionAr = [
    `نقدم لكم ${cat.ar} مميزة بعنوان «${input.nameAr || cat.ar}» ${purposeAr} في ${placeAr || 'سلطنة عُمان'}.`,
    roomDetailsAr(input),
    `العقار ${furnishAr}${input.street ? `، ويقع على ${input.street}` : ''}.`,
    amenAr.length ? `من أبرز المرافق: ${amenAr.join('، ')}.` : null,
    'موقع مناسب للمعيشة والعمل، مع إدارة موثوقة عبر منصة BHD R.',
  ]
    .filter(Boolean)
    .join(' ');

  const descriptionEn = [
    `A distinguished ${cat.en} titled “${titleEn}” ${purposeEn} in ${placeEn || 'the Sultanate of Oman'}.`,
    roomDetailsEn(input),
    `The property is ${furnishEn}${input.street ? `, located on ${input.street}` : ''}.`,
    amenEn.length ? `Key amenities include: ${amenEn.join(', ')}.` : null,
    'A practical location for living and work, professionally managed through BHD R.',
  ]
    .filter(Boolean)
    .join(' ');

  return { descriptionAr, descriptionEn };
}

export type UnitDescriptionInput = {
  unitNameAr: string;
  unitNameEn: string;
  unitCode: string;
  unitKind: 'apartment' | 'shop' | 'showroom';
  floor?: string | undefined;
  bedrooms: number;
  bathrooms: number;
  majlis?: number | undefined;
  halls?: number | undefined;
  kitchens?: number | undefined;
  hasPool?: boolean | undefined;
  area?: string | undefined;
  listingPurpose: 'rent' | 'sale' | 'both';
  rentLabel?: string | undefined;
  saleLabel?: string | undefined;
  buildingNameAr: string;
  buildingNameEn: string;
  buildingSerial?: string | null | undefined;
  buildingDescriptionAr?: string | null | undefined;
  buildingDescriptionEn?: string | null | undefined;
  buildingYearBuilt?: number | string | undefined;
  buildingTotalArea?: string | undefined;
  governorate?: string | undefined;
  wilayat?: string | undefined;
  village?: string | undefined;
};

/** Unit-first copy, then a building affiliation footer (serial + building details). */
export function generateUnitListingDescriptions(input: UnitDescriptionInput): {
  descriptionAr: string;
  descriptionEn: string;
} {
  const kindAr =
    input.unitKind === 'shop' ? 'محل' : input.unitKind === 'showroom' ? 'معرض' : 'شقة';
  const kindEn =
    input.unitKind === 'shop' ? 'shop' : input.unitKind === 'showroom' ? 'showroom' : 'apartment';
  const purposeAr =
    input.listingPurpose === 'sale'
      ? 'للبيع'
      : input.listingPurpose === 'both'
        ? 'للإيجار أو البيع'
        : 'للإيجار';
  const purposeEn =
    input.listingPurpose === 'sale'
      ? 'for sale'
      : input.listingPurpose === 'both'
        ? 'for rent or sale'
        : 'for rent';
  const placeAr = [input.village, input.wilayat, input.governorate].filter(Boolean).join('، ');
  const placeParts = [input.village, input.wilayat, input.governorate].filter(
    (part): part is string => Boolean(part),
  );
  const placeEn = placeParts.map((part) => lexiconTranslate(part, 'en')).join(', ');

  const roomAr = roomDetailsAr({
    nameAr: input.unitNameAr,
    nameEn: input.unitNameEn,
    category: input.unitKind === 'shop' ? 'shop' : input.unitKind === 'showroom' ? 'office' : 'apartment',
    governorate: input.governorate ?? '',
    wilayat: input.wilayat ?? '',
    village: input.village ?? '',
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    majlis: input.majlis,
    halls: input.halls,
    kitchens: input.kitchens,
    hasPool: input.hasPool,
    area: input.area,
    listingPurpose: input.listingPurpose,
    furnishing: 'unfurnished',
    amenities: [],
  });
  const roomEn = roomDetailsEn({
    nameAr: input.unitNameAr,
    nameEn: input.unitNameEn,
    category: input.unitKind === 'shop' ? 'shop' : input.unitKind === 'showroom' ? 'office' : 'apartment',
    governorate: input.governorate ?? '',
    wilayat: input.wilayat ?? '',
    village: input.village ?? '',
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    majlis: input.majlis,
    halls: input.halls,
    kitchens: input.kitchens,
    hasPool: input.hasPool,
    area: input.area,
    listingPurpose: input.listingPurpose,
    furnishing: 'unfurnished',
    amenities: [],
  });

  const unitBodyAr = [
    `نقدم لكم ${kindAr} «${input.unitNameAr || input.unitCode}» (${input.unitCode}) ${purposeAr}${placeAr ? ` في ${placeAr}` : ''}.`,
    input.floor ? `تقع في الطابق ${input.floor}.` : null,
    roomAr,
    input.rentLabel && input.listingPurpose !== 'sale'
      ? `الإيجار الشهري: ${input.rentLabel}.`
      : null,
    input.saleLabel && input.listingPurpose !== 'rent' ? `سعر البيع: ${input.saleLabel}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const unitBodyEn = [
    `A ${kindEn} titled “${input.unitNameEn || input.unitCode}” (${input.unitCode}) ${purposeEn}${placeEn ? ` in ${placeEn}` : ''}.`,
    input.floor ? `Located on floor ${input.floor}.` : null,
    roomEn,
    input.rentLabel && input.listingPurpose !== 'sale'
      ? `Monthly rent: ${input.rentLabel}.`
      : null,
    input.saleLabel && input.listingPurpose !== 'rent' ? `Sale price: ${input.saleLabel}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const ageAr = buildingAgePhrase(input.buildingYearBuilt, 'ar');
  const ageEn = buildingAgePhrase(input.buildingYearBuilt, 'en');
  const buildingFooterAr = [
    `هذه الوحدة مرتبطة بالمبنى الرئيسي «${input.buildingNameAr}».`,
    input.buildingSerial ? `الرقم المتسلسل للمبنى: ${input.buildingSerial}.` : null,
    ageAr ? `${ageAr}.` : null,
    input.buildingTotalArea
      ? `المساحة الإجمالية للمبنى تقارب ${input.buildingTotalArea} م².`
      : null,
    input.buildingDescriptionAr?.trim()
      ? `عن المبنى: ${input.buildingDescriptionAr.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const buildingFooterEn = [
    `This unit is linked to the main building “${input.buildingNameEn || input.buildingNameAr}”.`,
    input.buildingSerial ? `Building serial: ${input.buildingSerial}.` : null,
    ageEn ? `${ageEn}.` : null,
    input.buildingTotalArea
      ? `Total building area is approximately ${input.buildingTotalArea} m².`
      : null,
    input.buildingDescriptionEn?.trim() || input.buildingDescriptionAr?.trim()
      ? `About the building: ${(input.buildingDescriptionEn || input.buildingDescriptionAr || '').trim()}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    descriptionAr: `${unitBodyAr}\n\n${buildingFooterAr}`.trim(),
    descriptionEn: `${unitBodyEn}\n\n${buildingFooterEn}`.trim(),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Deterministic lexicon translation (AR↔EN) for names and short phrases. */
export function lexiconTranslate(text: string, target: 'ar' | 'en'): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  let out = trimmed;
  const ordered = [...LEXICON].sort((a, b) => b[0].length - a[0].length);
  for (const [ar, en] of ordered) {
    if (target === 'en') {
      out = out.replace(new RegExp(escapeRegExp(ar), 'gi'), en);
    } else {
      out = out.replace(new RegExp(escapeRegExp(en), 'gi'), ar);
    }
  }
  return out;
}

/**
 * Translate text AR↔EN:
 * 1) Same-origin `/api/translate` (MyMemory server-side — no CORS)
 * 2) Lexicon fallback for titles / known Oman terms
 */
export async function translateText(text: string, target: 'ar' | 'en'): Promise<string> {
  const source = text.trim();
  if (!source) return '';

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: source, target }),
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) {
      const payload = (await response.json()) as { translated?: string };
      const translated = payload.translated?.trim();
      if (translated && translated.toLowerCase() !== source.toLowerCase()) {
        return translated;
      }
    } else {
      const payload = (await response.json().catch(() => null)) as {
        messageAr?: string;
        message?: string;
        error?: string;
      } | null;
      throw new Error(payload?.messageAr ?? payload?.message ?? payload?.error ?? 'translate_failed');
    }
  } catch (error) {
    if (error instanceof Error && error.message && error.message !== 'translate_failed') {
      throw error;
    }
    /* fall through to lexicon */
  }

  const lexicon = lexiconTranslate(source, target);
  if (lexicon && lexicon.toLowerCase() !== source.toLowerCase()) {
    return lexicon;
  }
  throw new Error('translate_failed');
}

/** @deprecated use translateText — kept for call-site compatibility during migrate */
export function assistTranslate(text: string, target: 'ar' | 'en'): string {
  return lexiconTranslate(text, target) || text;
}
