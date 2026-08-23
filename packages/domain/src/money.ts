import { Decimal } from 'decimal.js';

export const currencyMinorUnits = {
  OMR: 3,
  BHD: 3,
  KWD: 3,
  SAR: 2,
  AED: 2,
  QAR: 2,
  USD: 2,
} as const;

export type SupportedCurrency = keyof typeof currencyMinorUnits;

export interface MoneyValue {
  amountMinor: bigint;
  currency: string;
  minorUnit: number;
}

export function parseMajorAmount(value: string, currency: string, minorUnit: number): MoneyValue {
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) {
    throw new RangeError('minorUnit must be an integer between 0 and 6');
  }

  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative())
    throw new RangeError('Amount must be finite and non-negative');
  const scaled = decimal.mul(new Decimal(10).pow(minorUnit));
  if (!scaled.isInteger()) throw new RangeError(`Amount has more than ${minorUnit} decimal places`);
  return { amountMinor: BigInt(scaled.toFixed(0)), currency, minorUnit };
}

export function addMoney(values: readonly MoneyValue[]): MoneyValue {
  const first = values[0];
  if (!first) throw new RangeError('At least one amount is required');
  for (const value of values) {
    if (value.currency !== first.currency || value.minorUnit !== first.minorUnit) {
      throw new RangeError('Currency and minor unit must match');
    }
  }
  return {
    amountMinor: values.reduce((sum, value) => sum + value.amountMinor, 0n),
    currency: first.currency,
    minorUnit: first.minorUnit,
  };
}

export function multiplyMoney(value: MoneyValue, quantity: string): MoneyValue {
  const result = new Decimal(value.amountMinor.toString()).mul(quantity);
  if (!result.isInteger())
    throw new RangeError('Result cannot be represented in the currency minor unit');
  return { ...value, amountMinor: BigInt(result.toFixed(0)) };
}

export function formatMoney(value: MoneyValue, locale: 'ar' | 'en' = 'ar'): string {
  const major = new Decimal(value.amountMinor.toString()).div(new Decimal(10).pow(value.minorUnit));
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: value.minorUnit,
    maximumFractionDigits: value.minorUnit,
  }).format(major.toNumber());
}
