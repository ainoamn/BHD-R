import { Decimal } from 'decimal.js';
import { currencyMinorUnits, type MoneyValue, type SupportedCurrency } from '../money.js';

export type { MoneyValue, SupportedCurrency };

/** Format minor units as a decimal string without float. */
export function minorToString(amountMinor: bigint): string {
  return amountMinor.toString();
}

/** Scale a major Decimal into minor units (must be exact for the currency). */
export function majorDecimalToMinor(value: Decimal, minorUnit: number): bigint {
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) {
    throw new RangeError('minorUnit must be an integer between 0 and 6');
  }
  if (!value.isFinite() || value.isNegative()) {
    throw new RangeError('Amount must be finite and non-negative');
  }
  const scaled = value.mul(new Decimal(10).pow(minorUnit));
  if (!scaled.isInteger()) {
    throw new RangeError(`Amount has more than ${minorUnit} decimal places`);
  }
  return BigInt(scaled.toFixed(0));
}

export function moneyFromMinor(amountMinor: bigint, currency: SupportedCurrency): MoneyValue {
  return {
    amountMinor,
    currency,
    minorUnit: currencyMinorUnits[currency],
  };
}
