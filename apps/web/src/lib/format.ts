import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';

export function formatMoney(amountMinor: string, currency: string, locale: string): string {
  const knownCurrency = currency as CurrencyCode;
  const minor = currencyMinorUnits[knownCurrency] ?? 2;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
    style: 'currency',
    currency,
    minimumFractionDigits: minor,
    maximumFractionDigits: minor,
  }).format(Number(amountMinor) / 10 ** minor);
}

export function toMinorUnits(amount: string, currency: CurrencyCode): string {
  const normalized = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('invalid_amount');
  const minor = currencyMinorUnits[currency];
  const [whole = '0', decimals = ''] = normalized.split('.');
  const padded = `${decimals}${'0'.repeat(minor)}`.slice(0, minor);
  return (BigInt(whole) * 10n ** BigInt(minor) + BigInt(padded || '0')).toString();
}

export function localizedName(locale: string, ar: string, en: string): string {
  return locale === 'ar' ? ar : en;
}
