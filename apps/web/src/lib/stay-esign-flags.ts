/** Post-pay e-sign is on unless explicitly disabled with `0` / `false`. */

function isEnabledFlag(value: string | undefined): boolean {
  const normalized = value?.replace(/^\uFEFF/, '').trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

/** Client / build-time: drives returnPath after payment. */
export function isStayEsignRequiredClient(): boolean {
  return isEnabledFlag(process.env.NEXT_PUBLIC_STAY_ESIGN_REQUIRED);
}

/** Server: sign page, API, and confirmed-page gate. */
export function isStayEsignRequiredServer(): boolean {
  return isEnabledFlag(process.env.STAY_ESIGN_REQUIRED);
}

export function stayEsignReturnPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/stays/booking/sign?ref=${encodeURIComponent(referenceCode)}`;
}

export function stayConfirmedReturnPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/stays/booking/confirmed?ref=${encodeURIComponent(referenceCode)}`;
}

export function localeFromReturnPath(returnPath: string | null | undefined): 'ar' | 'en' {
  if (returnPath?.startsWith('/en/')) return 'en';
  return 'ar';
}
