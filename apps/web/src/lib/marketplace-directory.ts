/**
 * Public marketplace directories: real-estate offices, appraisers, and insurers.
 * Seed catalogue is ready for display; swap the loader for Neon when partners onboard.
 */

export type MarketplaceKind = 'office' | 'appraiser' | 'insurer';

export type MarketplaceCity =
  | 'muscat'
  | 'seeb'
  | 'baushar'
  | 'mutrah'
  | 'salalah'
  | 'sohar'
  | 'nizwa'
  | 'sur';

export type MarketplaceEntry = {
  id: string;
  kind: MarketplaceKind;
  slug: string;
  nameAr: string;
  nameEn: string;
  taglineAr: string;
  taglineEn: string;
  city: MarketplaceCity;
  specialtiesAr: string[];
  specialtiesEn: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  verified: boolean;
  featured: boolean;
};

export const MARKETPLACE_CITY_LABELS: Record<MarketplaceCity, { ar: string; en: string }> = {
  muscat: { ar: 'مسقط', en: 'Muscat' },
  seeb: { ar: 'السيب', en: 'Seeb' },
  baushar: { ar: 'بوشر', en: 'Baushar' },
  mutrah: { ar: 'مطرح', en: 'Mutrah' },
  salalah: { ar: 'صلالة', en: 'Salalah' },
  sohar: { ar: 'صحار', en: 'Sohar' },
  nizwa: { ar: 'نزوى', en: 'Nizwa' },
  sur: { ar: 'صور', en: 'Sur' },
};

export const MARKETPLACE_KIND_META: Record<
  MarketplaceKind,
  { path: string; ar: string; en: string; kickerAr: string; kickerEn: string }
> = {
  office: {
    path: '/offices',
    ar: 'المكاتب العقارية',
    en: 'Real estate offices',
    kickerAr: 'دليل المكاتب',
    kickerEn: 'Office directory',
  },
  appraiser: {
    path: '/appraisers',
    ar: 'المثمّنون العقاريون',
    en: 'Property appraisers',
    kickerAr: 'دليل التثمين',
    kickerEn: 'Appraiser directory',
  },
  insurer: {
    path: '/insurance',
    ar: 'التأمين العقاري',
    en: 'Property insurance',
    kickerAr: 'شركاء التأمين',
    kickerEn: 'Insurance partners',
  },
};

/** Curated starter catalogue — replace with Neon-backed partners later. */
export const MARKETPLACE_CATALOGUE: MarketplaceEntry[] = [
  {
    id: 'off-01',
    kind: 'office',
    slug: 'masqat-prime-realty',
    nameAr: 'مكتب مسقط برايم العقاري',
    nameEn: 'Masqat Prime Realty',
    taglineAr: 'بيع وإيجار سكني وتجاري في مسقط وبوشر.',
    taglineEn: 'Residential and commercial sales & rentals in Muscat and Baushar.',
    city: 'muscat',
    specialtiesAr: ['بيع', 'إيجار', 'سكني', 'تجاري'],
    specialtiesEn: ['Sale', 'Rent', 'Residential', 'Commercial'],
    phone: '+968 24 000 101',
    email: 'prime@example.bhd-om.local',
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'off-02',
    kind: 'office',
    slug: 'seeb-horizon',
    nameAr: 'أفق السيب للعقارات',
    nameEn: 'Seeb Horizon Properties',
    taglineAr: 'فلل وشقق على الساحل مع متابعة عقود الإيجار.',
    taglineEn: 'Coastal villas and apartments with lease follow-through.',
    city: 'seeb',
    specialtiesAr: ['فلل', 'شقق', 'إدارة إيجار'],
    specialtiesEn: ['Villas', 'Apartments', 'Lease management'],
    phone: '+968 24 000 102',
    email: null,
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'off-03',
    kind: 'office',
    slug: 'baushar-estate',
    nameAr: 'بوشر إستيت',
    nameEn: 'Baushar Estate',
    taglineAr: 'وحدات فاخرة ومشاريع قيد التطوير في بوشر.',
    taglineEn: 'Premium units and off-plan projects in Baushar.',
    city: 'baushar',
    specialtiesAr: ['فاخر', 'تحت الإنشاء', 'بيع'],
    specialtiesEn: ['Luxury', 'Off-plan', 'Sale'],
    phone: '+968 24 000 103',
    email: 'baushar@example.bhd-om.local',
    website: null,
    verified: false,
    featured: false,
  },
  {
    id: 'off-04',
    kind: 'office',
    slug: 'salalah-coast',
    nameAr: 'ساحل صلالة العقاري',
    nameEn: 'Salalah Coast Realty',
    taglineAr: 'عقارات سياحية واستثمارية في ظفار.',
    taglineEn: 'Tourism and investment property in Dhofar.',
    city: 'salalah',
    specialtiesAr: ['سياحي', 'استثمار', 'إيجار يومي'],
    specialtiesEn: ['Tourism', 'Investment', 'Short stay'],
    phone: '+968 23 000 104',
    email: null,
    website: null,
    verified: true,
    featured: false,
  },
  {
    id: 'off-05',
    kind: 'office',
    slug: 'sohar-gateway',
    nameAr: 'بوابة صحار',
    nameEn: 'Sohar Gateway',
    taglineAr: 'أراضٍ ومخازن ومكاتب قرب الميناء والمنطقة الصناعية.',
    taglineEn: 'Land, warehouses and offices near the port and industrial zone.',
    city: 'sohar',
    specialtiesAr: ['أراضٍ', 'صناعي', 'تجاري'],
    specialtiesEn: ['Land', 'Industrial', 'Commercial'],
    phone: '+968 26 000 105',
    email: null,
    website: null,
    verified: false,
    featured: false,
  },
  {
    id: 'off-06',
    kind: 'office',
    slug: 'mutrah-heritage',
    nameAr: 'مطرح هيريتج',
    nameEn: 'Mutrah Heritage Realty',
    taglineAr: 'عقارات تراثية وتجارية في مطرح والمدينة القديمة.',
    taglineEn: 'Heritage and retail property in Mutrah and the old town.',
    city: 'mutrah',
    specialtiesAr: ['تراثي', 'تجاري', 'إيجار'],
    specialtiesEn: ['Heritage', 'Retail', 'Rent'],
    phone: '+968 24 000 106',
    email: null,
    website: null,
    verified: true,
    featured: false,
  },
  {
    id: 'ap-01',
    kind: 'appraiser',
    slug: 'oman-valuation-house',
    nameAr: 'بيت التثمين العماني',
    nameEn: 'Oman Valuation House',
    taglineAr: 'تثمين سكني وتجاري للتمويل والبيع والمنازعات.',
    taglineEn: 'Residential and commercial valuations for finance, sale and disputes.',
    city: 'muscat',
    specialtiesAr: ['سكني', 'تجاري', 'تمويل بنكي'],
    specialtiesEn: ['Residential', 'Commercial', 'Bank finance'],
    phone: '+968 24 100 201',
    email: 'value@example.bhd-om.local',
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'ap-02',
    kind: 'appraiser',
    slug: 'gulf-appraisal',
    nameAr: 'الخليج للتثمين العقاري',
    nameEn: 'Gulf Appraisal',
    taglineAr: 'تقارير مثمّنين معتمدة للمطورين والمصارف.',
    taglineEn: 'Certified appraisal reports for developers and banks.',
    city: 'baushar',
    specialtiesAr: ['مشاريع', 'أراضٍ', 'مصارف'],
    specialtiesEn: ['Projects', 'Land', 'Banks'],
    phone: '+968 24 100 202',
    email: null,
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'ap-03',
    kind: 'appraiser',
    slug: 'dhofar-valuers',
    nameAr: 'مثمّنو ظفار',
    nameEn: 'Dhofar Valuers',
    taglineAr: 'تثمين محلي لصلالة والمناطق السياحية.',
    taglineEn: 'Local valuations for Salalah and tourism zones.',
    city: 'salalah',
    specialtiesAr: ['سياحي', 'سكني'],
    specialtiesEn: ['Tourism', 'Residential'],
    phone: '+968 23 100 203',
    email: null,
    website: null,
    verified: false,
    featured: false,
  },
  {
    id: 'ap-04',
    kind: 'appraiser',
    slug: 'nizwa-land-value',
    nameAr: 'نزوى لتثمين الأراضي',
    nameEn: 'Nizwa Land Value',
    taglineAr: 'تثمين أراضٍ ومزارع في الداخلية.',
    taglineEn: 'Land and farm valuations in Al Dakhiliyah.',
    city: 'nizwa',
    specialtiesAr: ['أراضٍ', 'زراعي'],
    specialtiesEn: ['Land', 'Agricultural'],
    phone: '+968 25 100 204',
    email: null,
    website: null,
    verified: true,
    featured: false,
  },
  {
    id: 'ap-05',
    kind: 'appraiser',
    slug: 'capital-appraisal',
    nameAr: 'كابيتال أبريزال',
    nameEn: 'Capital Appraisal',
    taglineAr: 'تثمين سريع للشقق والفلل في مسقط والسيب.',
    taglineEn: 'Fast apartment and villa appraisals in Muscat and Seeb.',
    city: 'seeb',
    specialtiesAr: ['شقق', 'فلل', 'سريع'],
    specialtiesEn: ['Apartments', 'Villas', 'Express'],
    phone: '+968 24 100 205',
    email: 'capital@example.bhd-om.local',
    website: null,
    verified: true,
    featured: false,
  },
  {
    id: 'in-01',
    kind: 'insurer',
    slug: 'property-shield',
    nameAr: 'درع العقار للتأمين',
    nameEn: 'Property Shield Insurance',
    taglineAr: 'تأمين مباني ومحتويات ومسؤولية للمستأجر والمالك.',
    taglineEn: 'Building, contents and liability cover for landlords and tenants.',
    city: 'muscat',
    specialtiesAr: ['مباني', 'محتويات', 'مسؤولية'],
    specialtiesEn: ['Buildings', 'Contents', 'Liability'],
    phone: '+968 24 200 301',
    email: 'shield@example.bhd-om.local',
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'in-02',
    kind: 'insurer',
    slug: 'oman-home-cover',
    nameAr: 'تغطية المنزل العمانية',
    nameEn: 'Oman Home Cover',
    taglineAr: 'باقات تأمين سكني مرنة للشقق والفلل.',
    taglineEn: 'Flexible home insurance packages for flats and villas.',
    city: 'baushar',
    specialtiesAr: ['سكني', 'حريق', 'كوارث'],
    specialtiesEn: ['Home', 'Fire', 'Natural perils'],
    phone: '+968 24 200 302',
    email: null,
    website: null,
    verified: true,
    featured: true,
  },
  {
    id: 'in-03',
    kind: 'insurer',
    slug: 'coastal-risk',
    nameAr: 'المخاطر الساحلية',
    nameEn: 'Coastal Risk Cover',
    taglineAr: 'تأمين عقارات ساحلية وفنادق صغيرة في ظفار والباطنة.',
    taglineEn: 'Coastal property and small-hotel cover in Dhofar and Al Batinah.',
    city: 'salalah',
    specialtiesAr: ['ساحلي', 'ضيافة'],
    specialtiesEn: ['Coastal', 'Hospitality'],
    phone: '+968 23 200 303',
    email: null,
    website: null,
    verified: false,
    featured: false,
  },
  {
    id: 'in-04',
    kind: 'insurer',
    slug: 'landlord-protect',
    nameAr: 'حماية المؤجّر',
    nameEn: 'Landlord Protect',
    taglineAr: 'تأمين مخصّص لمحافظ الإيجار وتحصيل الأضرار.',
    taglineEn: 'Cover tailored to rental portfolios and damage recovery.',
    city: 'muscat',
    specialtiesAr: ['محافظ إيجار', 'أضرار', 'إخلاء'],
    specialtiesEn: ['Rental portfolios', 'Damage', 'Vacancy'],
    phone: '+968 24 200 304',
    email: 'landlord@example.bhd-om.local',
    website: null,
    verified: true,
    featured: false,
  },
];

export function listMarketplace(
  kind: MarketplaceKind,
  options?: { city?: MarketplaceCity | 'all'; q?: string; featuredOnly?: boolean },
): MarketplaceEntry[] {
  const city = options?.city && options.city !== 'all' ? options.city : null;
  const q = (options?.q ?? '').trim().toLowerCase();
  return MARKETPLACE_CATALOGUE.filter((row) => {
    if (row.kind !== kind) return false;
    if (options?.featuredOnly && !row.featured) return false;
    if (city && row.city !== city) return false;
    if (!q) return true;
    const hay = [
      row.nameAr,
      row.nameEn,
      row.taglineAr,
      row.taglineEn,
      ...row.specialtiesAr,
      ...row.specialtiesEn,
      MARKETPLACE_CITY_LABELS[row.city].ar,
      MARKETPLACE_CITY_LABELS[row.city].en,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => Number(b.featured) - Number(a.featured) || a.nameEn.localeCompare(b.nameEn));
}

export function featuredMarketplace(kind: MarketplaceKind, limit = 4): MarketplaceEntry[] {
  return listMarketplace(kind, { featuredOnly: true }).slice(0, limit);
}

export function citiesForKind(kind: MarketplaceKind): MarketplaceCity[] {
  return [
    ...new Set(MARKETPLACE_CATALOGUE.filter((row) => row.kind === kind).map((row) => row.city)),
  ];
}
