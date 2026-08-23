import type { CurrencyCode } from '@bhd-r/contracts';
import { z } from 'zod';

export interface LocalizedText {
  ar: string;
  en: string;
}

export interface CountryPack {
  countryCode: 'OM' | 'AE' | 'SA' | 'BH' | 'KW' | 'QA' | 'US';
  name: LocalizedText;
  defaultCurrency: CurrencyCode;
  acceptedCurrencies: readonly CurrencyCode[];
  locales: readonly ['ar', 'en'];
  timeZone: string;
  phoneCountryCode: string;
  phoneNationalPattern: RegExp;
  addressLevels: readonly LocalizedText[];
  tax: {
    label: LocalizedText;
    registrationNumberLabel: LocalizedText;
    defaultRateBasisPoints: number | null;
    requiresProfessionalReview: true;
  };
  invoicePrefix: string;
}

const gulfPack = (
  input: Omit<CountryPack, 'locales' | 'acceptedCurrencies' | 'tax'> & {
    acceptedCurrencies?: readonly CurrencyCode[];
    taxRateBasisPoints?: number | null;
  },
): CountryPack => ({
  ...input,
  locales: ['ar', 'en'],
  acceptedCurrencies: input.acceptedCurrencies ?? [input.defaultCurrency, 'USD'],
  tax: {
    label: { ar: 'ضريبة القيمة المضافة', en: 'Value Added Tax' },
    registrationNumberLabel: { ar: 'الرقم الضريبي', en: 'Tax Registration Number' },
    defaultRateBasisPoints: input.taxRateBasisPoints ?? null,
    requiresProfessionalReview: true,
  },
});

export const countryPacks = {
  OM: gulfPack({
    countryCode: 'OM',
    name: { ar: 'سلطنة عُمان', en: 'Sultanate of Oman' },
    defaultCurrency: 'OMR',
    timeZone: 'Asia/Muscat',
    phoneCountryCode: '+968',
    phoneNationalPattern: /^[279]\d{7}$/,
    addressLevels: [
      { ar: 'المحافظة', en: 'Governorate' },
      { ar: 'الولاية', en: 'Wilayat' },
      { ar: 'المنطقة', en: 'Area' },
    ],
    taxRateBasisPoints: 500,
    invoicePrefix: 'OM',
  }),
  AE: gulfPack({
    countryCode: 'AE',
    name: { ar: 'الإمارات العربية المتحدة', en: 'United Arab Emirates' },
    defaultCurrency: 'AED',
    timeZone: 'Asia/Dubai',
    phoneCountryCode: '+971',
    phoneNationalPattern: /^\d{8,9}$/,
    addressLevels: [
      { ar: 'الإمارة', en: 'Emirate' },
      { ar: 'المدينة', en: 'City' },
      { ar: 'المنطقة', en: 'Area' },
    ],
    invoicePrefix: 'AE',
  }),
  SA: gulfPack({
    countryCode: 'SA',
    name: { ar: 'المملكة العربية السعودية', en: 'Saudi Arabia' },
    defaultCurrency: 'SAR',
    timeZone: 'Asia/Riyadh',
    phoneCountryCode: '+966',
    phoneNationalPattern: /^\d{9}$/,
    addressLevels: [
      { ar: 'المنطقة', en: 'Region' },
      { ar: 'المدينة', en: 'City' },
      { ar: 'الحي', en: 'District' },
    ],
    invoicePrefix: 'SA',
  }),
  BH: gulfPack({
    countryCode: 'BH',
    name: { ar: 'مملكة البحرين', en: 'Kingdom of Bahrain' },
    defaultCurrency: 'BHD',
    timeZone: 'Asia/Bahrain',
    phoneCountryCode: '+973',
    phoneNationalPattern: /^\d{8}$/,
    addressLevels: [
      { ar: 'المحافظة', en: 'Governorate' },
      { ar: 'المنطقة', en: 'Area' },
      { ar: 'المجمع', en: 'Block' },
    ],
    invoicePrefix: 'BH',
  }),
  KW: gulfPack({
    countryCode: 'KW',
    name: { ar: 'دولة الكويت', en: 'State of Kuwait' },
    defaultCurrency: 'KWD',
    timeZone: 'Asia/Kuwait',
    phoneCountryCode: '+965',
    phoneNationalPattern: /^\d{8}$/,
    addressLevels: [
      { ar: 'المحافظة', en: 'Governorate' },
      { ar: 'المنطقة', en: 'Area' },
      { ar: 'القطعة', en: 'Block' },
    ],
    invoicePrefix: 'KW',
  }),
  QA: gulfPack({
    countryCode: 'QA',
    name: { ar: 'دولة قطر', en: 'State of Qatar' },
    defaultCurrency: 'QAR',
    timeZone: 'Asia/Qatar',
    phoneCountryCode: '+974',
    phoneNationalPattern: /^\d{8}$/,
    addressLevels: [
      { ar: 'البلدية', en: 'Municipality' },
      { ar: 'المنطقة', en: 'Zone' },
      { ar: 'الشارع', en: 'Street' },
    ],
    invoicePrefix: 'QA',
  }),
  US: gulfPack({
    countryCode: 'US',
    name: { ar: 'الولايات المتحدة', en: 'United States' },
    defaultCurrency: 'USD',
    timeZone: 'UTC',
    phoneCountryCode: '+1',
    phoneNationalPattern: /^\d{10}$/,
    addressLevels: [
      { ar: 'الولاية', en: 'State' },
      { ar: 'المدينة', en: 'City' },
      { ar: 'الرمز البريدي', en: 'ZIP code' },
    ],
    invoicePrefix: 'US',
  }),
} as const satisfies Record<string, CountryPack>;

export const countryPackCodeSchema = z.enum(['OM', 'AE', 'SA', 'BH', 'KW', 'QA', 'US']);
export type CountryPackCode = z.infer<typeof countryPackCodeSchema>;

export function getCountryPack(code: string): CountryPack {
  return countryPacks[countryPackCodeSchema.parse(code)];
}

export function validateNationalPhone(countryCode: CountryPackCode, phone: string): boolean {
  return countryPacks[countryCode].phoneNationalPattern.test(phone.replace(/[\s-]/g, ''));
}
