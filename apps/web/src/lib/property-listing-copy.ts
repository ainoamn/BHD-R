/** Professional bilingual listing copy helpers (template AI — editable by user). */

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
  area?: string;
  listingPurpose: 'rent' | 'sale' | 'both';
  furnishing: string;
  amenities: Array<{ code: string; labelAr: string; labelEn: string }>;
};

export function generateListingDescriptions(input: DescriptionInput): {
  descriptionAr: string;
  descriptionEn: string;
} {
  const cat = categoryLabels[input.category] ?? categoryLabels.other!;
  const place = [input.village, input.wilayat, input.governorate].filter(Boolean).join('، ');
  const placeEn = [input.village, input.wilayat, input.governorate].filter(Boolean).join(', ');
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
  const amenAr = input.amenities
    .slice(0, 8)
    .map((a) => amenityPhrase[a.code]?.ar ?? a.labelAr)
    .filter(Boolean);
  const amenEn = input.amenities
    .slice(0, 8)
    .map((a) => amenityPhrase[a.code]?.en ?? a.labelEn)
    .filter(Boolean);

  const descriptionAr = [
    `نقدم لكم ${cat.ar} مميزة بعنوان «${input.nameAr || cat.ar}» ${purposeAr} في ${place || 'سلطنة عُمان'}.`,
    input.bedrooms || input.bathrooms
      ? `تضم ${input.bedrooms} غرفة نوم و${input.bathrooms} حمّام${input.area ? `، بمساحة تقارب ${input.area} م²` : ''}.`
      : null,
    `العقار ${furnishAr}${input.street ? `، ويقع على ${input.street}` : ''}.`,
    amenAr.length ? `من أبرز المرافق: ${amenAr.join('، ')}.` : null,
    'موقع مناسب للمعيشة والعمل، مع إدارة موثوقة عبر منصة BHD R.',
  ]
    .filter(Boolean)
    .join(' ');

  const descriptionEn = [
    `A distinguished ${cat.en} titled “${input.nameEn || cat.en}” ${purposeEn} in ${placeEn || 'the Sultanate of Oman'}.`,
    input.bedrooms || input.bathrooms
      ? `It features ${input.bedrooms} bedroom(s) and ${input.bathrooms} bathroom(s)${input.area ? `, approximately ${input.area} m²` : ''}.`
      : null,
    `The property is ${furnishEn}${input.street ? `, located on ${input.street}` : ''}.`,
    amenEn.length ? `Key amenities include: ${amenEn.join(', ')}.` : null,
    'A practical location for living and work, professionally managed through BHD R.',
  ]
    .filter(Boolean)
    .join(' ');

  return { descriptionAr, descriptionEn };
}

/** Lightweight phrase map for instant AR↔EN assist on short titles / lines. */
const phrasePairs: Array<[RegExp, string, 'ar' | 'en']> = [
  [/للإيجار/g, 'for rent', 'en'],
  [/للبيع/g, 'for sale', 'en'],
  [/شقة/g, 'apartment', 'en'],
  [/فيلا/g, 'villa', 'en'],
  [/مسبح/g, 'pool', 'en'],
  [/مواقف/g, 'parking', 'en'],
  [/for rent/gi, 'للإيجار', 'ar'],
  [/for sale/gi, 'للبيع', 'ar'],
  [/apartment/gi, 'شقة', 'ar'],
  [/villa/gi, 'فيلا', 'ar'],
  [/parking/gi, 'مواقف', 'ar'],
  [/pool/gi, 'مسبح', 'ar'],
];

export function assistTranslate(text: string, target: 'ar' | 'en'): string {
  let out = text;
  for (const [pattern, replacement, dir] of phrasePairs) {
    if (dir === target) out = out.replace(pattern, replacement);
  }
  return out;
}
