export function leaseSignPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/sign?ref=${encodeURIComponent(referenceCode)}`;
}

export function leaseConfirmedPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/confirmed?ref=${encodeURIComponent(referenceCode)}`;
}
