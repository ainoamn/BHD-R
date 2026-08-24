import { createDatabase, countryPacks, currencies } from './index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const { client, db } = createDatabase(databaseUrl, { max: 1 });

const currencyRows = [
  ['OMR', 'الريال العماني', 'Omani Rial', 'ر.ع.', 'OMR', 3],
  ['BHD', 'الدينار البحريني', 'Bahraini Dinar', 'د.ب.', 'BHD', 3],
  ['KWD', 'الدينار الكويتي', 'Kuwaiti Dinar', 'د.ك.', 'KWD', 3],
  ['SAR', 'الريال السعودي', 'Saudi Riyal', 'ر.س.', 'SAR', 2],
  ['AED', 'الدرهم الإماراتي', 'UAE Dirham', 'د.إ.', 'AED', 2],
  ['QAR', 'الريال القطري', 'Qatari Riyal', 'ر.ق.', 'QAR', 2],
  ['USD', 'الدولار الأمريكي', 'US Dollar', '$', '$', 2],
] as const;

try {
  await db
    .insert(currencies)
    .values(
      currencyRows.map(([code, nameAr, nameEn, symbolAr, symbolEn, minorUnit]) => ({
        code,
        nameAr,
        nameEn,
        symbolAr,
        symbolEn,
        minorUnit,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(countryPacks)
    .values([
      {
        countryCode: 'OM',
        nameAr: 'سلطنة عُمان',
        nameEn: 'Sultanate of Oman',
        defaultCurrency: 'OMR',
        addressSchema: { levels: ['governorate', 'wilayat', 'city', 'area'], direction: 'rtl' },
        legalSettings: { vatRateBasisPoints: 500, timezone: 'Asia/Muscat', locale: 'ar-OM' },
      },
      {
        countryCode: 'AE',
        nameAr: 'الإمارات العربية المتحدة',
        nameEn: 'United Arab Emirates',
        defaultCurrency: 'AED',
        addressSchema: { levels: ['emirate', 'city', 'area'], direction: 'rtl' },
        legalSettings: { timezone: 'Asia/Dubai', locale: 'ar-AE', legalReviewRequired: true },
      },
      {
        countryCode: 'SA',
        nameAr: 'المملكة العربية السعودية',
        nameEn: 'Saudi Arabia',
        defaultCurrency: 'SAR',
        addressSchema: { levels: ['region', 'city', 'district'], direction: 'rtl' },
        legalSettings: { timezone: 'Asia/Riyadh', locale: 'ar-SA', legalReviewRequired: true },
      },
      {
        countryCode: 'BH',
        nameAr: 'مملكة البحرين',
        nameEn: 'Kingdom of Bahrain',
        defaultCurrency: 'BHD',
        addressSchema: { levels: ['governorate', 'area', 'block'], direction: 'rtl' },
        legalSettings: { timezone: 'Asia/Bahrain', locale: 'ar-BH', legalReviewRequired: true },
      },
      {
        countryCode: 'KW',
        nameAr: 'دولة الكويت',
        nameEn: 'State of Kuwait',
        defaultCurrency: 'KWD',
        addressSchema: { levels: ['governorate', 'area', 'block'], direction: 'rtl' },
        legalSettings: { timezone: 'Asia/Kuwait', locale: 'ar-KW', legalReviewRequired: true },
      },
      {
        countryCode: 'QA',
        nameAr: 'دولة قطر',
        nameEn: 'State of Qatar',
        defaultCurrency: 'QAR',
        addressSchema: { levels: ['municipality', 'zone', 'street'], direction: 'rtl' },
        legalSettings: { timezone: 'Asia/Qatar', locale: 'ar-QA', legalReviewRequired: true },
      },
      {
        countryCode: 'US',
        nameAr: 'الولايات المتحدة',
        nameEn: 'United States',
        defaultCurrency: 'USD',
        addressSchema: { levels: ['state', 'city', 'postalCode'], direction: 'ltr' },
        legalSettings: { timezone: 'UTC', locale: 'en-US', legalReviewRequired: true },
      },
    ])
    .onConflictDoNothing();
} finally {
  await client.end();
}
