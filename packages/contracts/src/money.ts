import { z } from 'zod';

export const supportedCurrencyCodes = ['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD'] as const;

export const currencyCodeSchema = z.enum(supportedCurrencyCodes);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const currencyMinorUnits: Readonly<Record<CurrencyCode, number>> = {
  OMR: 3,
  AED: 2,
  SAR: 2,
  BHD: 3,
  KWD: 3,
  QAR: 2,
  USD: 2,
};

export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/),
  currency: currencyCodeSchema,
});

export type Money = z.infer<typeof moneySchema>;

export function formatMoney(money: Money, locale: 'ar-OM' | 'en-OM' = 'ar-OM'): string {
  const minorUnits = currencyMinorUnits[money.currency];
  const amount = Number(money.amountMinor) / 10 ** minorUnits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(amount);
}
