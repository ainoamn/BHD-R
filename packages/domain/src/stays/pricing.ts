import { Decimal } from 'decimal.js';
import { currencyMinorUnits, type SupportedCurrency } from '../money.js';
import { nightsBetween, type StayDateRange } from './availability.js';
import { moneyFromMinor, minorToString } from './money.js';

export type StayPricingInput = {
  currency: SupportedCurrency;
  checkInOn: string;
  checkOutOn: string;
  /** Nightly base in minor units (integer string). */
  baseNightlyMinor: string;
  /** Optional weekend nightly override (Fri/Sat in Asia/Muscat calendar days). */
  weekendNightlyMinor?: string | null;
  /** One-time cleaning fee in minor units. */
  cleaningFeeMinor?: string | null;
  /** Weekend day numbers: 5=Friday, 6=Saturday (UTC date parts). Default Fri+Sat. */
  weekendDays?: readonly number[];
};

export type StayNightLine = {
  stayDate: string;
  amountMinor: string;
  isWeekend: boolean;
};

export type StayPricingResult = {
  currency: SupportedCurrency;
  minorUnit: number;
  nights: number;
  nightLines: StayNightLine[];
  subtotalMinor: string;
  cleaningFeeMinor: string;
  totalMinor: string;
};

function parseMinor(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new RangeError(`${field} must be a non-negative integer string`);
  return BigInt(value);
}

function isoDateUtc(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
}

function eachNightDate(range: StayDateRange): string[] {
  const nights = nightsBetween(range);
  const start = new Date(`${range.checkInOn}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let i = 0; i < nights; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000);
    dates.push(isoDateUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return dates;
}

/**
 * Nightly base + weekend override + one cleaning fee.
 * All math uses bigint / Decimal.js — never Number floats for money.
 */
export function quoteStay(input: StayPricingInput): StayPricingResult {
  const minorUnit = currencyMinorUnits[input.currency];
  const weekendDays = new Set(input.weekendDays ?? [5, 6]);
  const base = parseMinor(input.baseNightlyMinor, 'baseNightlyMinor');
  const weekend =
    input.weekendNightlyMinor != null && input.weekendNightlyMinor !== ''
      ? parseMinor(input.weekendNightlyMinor, 'weekendNightlyMinor')
      : base;
  const cleaning =
    input.cleaningFeeMinor != null && input.cleaningFeeMinor !== ''
      ? parseMinor(input.cleaningFeeMinor, 'cleaningFeeMinor')
      : 0n;

  const range = { checkInOn: input.checkInOn, checkOutOn: input.checkOutOn };
  const nightDates = eachNightDate(range);
  const nightLines: StayNightLine[] = nightDates.map((stayDate) => {
    const day = new Date(`${stayDate}T00:00:00.000Z`).getUTCDay();
    const isWeekend = weekendDays.has(day);
    const amount = isWeekend ? weekend : base;
    return { stayDate, amountMinor: minorToString(amount), isWeekend };
  });

  let subtotal = 0n;
  for (const line of nightLines) {
    subtotal += BigInt(line.amountMinor);
  }
  // Decimal cross-check that subtotal remains an integer (no float drift).
  const decimalCheck = new Decimal(subtotal.toString()).plus(new Decimal(cleaning.toString()));
  if (!decimalCheck.isInteger()) {
    throw new RangeError('Pricing result must remain an integer minor amount');
  }

  const total = subtotal + cleaning;
  moneyFromMinor(total, input.currency); // validates currency minor map

  return {
    currency: input.currency,
    minorUnit,
    nights: nightLines.length,
    nightLines,
    subtotalMinor: minorToString(subtotal),
    cleaningFeeMinor: minorToString(cleaning),
    totalMinor: minorToString(total),
  };
}
