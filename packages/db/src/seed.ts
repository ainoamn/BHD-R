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
    ])
    .onConflictDoNothing();
} finally {
  await client.end();
}
