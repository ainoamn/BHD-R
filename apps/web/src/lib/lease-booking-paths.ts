export function leaseSignPath(
  locale: string,
  referenceCode: string,
  options?: { au?: string | null; view?: boolean },
): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  const qs = new URLSearchParams({ ref: referenceCode });
  const au = options?.au?.trim();
  if (au) qs.set('au', au);
  if (options?.view) qs.set('view', '1');
  return `/${safeLocale}/book/sign?${qs.toString()}`;
}

/** Opens the booking document for whoever may see it: the customer, or the landlord's staff. */
export function leaseBookingDocumentPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/document?ref=${encodeURIComponent(referenceCode)}`;
}

export function leaseConfirmedPath(
  locale: string,
  referenceCode: string,
  options?: { au?: string | null },
): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  const qs = new URLSearchParams({ ref: referenceCode });
  const au = options?.au?.trim();
  if (au) qs.set('au', au);
  return `/${safeLocale}/book/confirmed?${qs.toString()}`;
}

/** Official arabon / booking-deposit receipt (same page for tenant and owner). */
export function leaseReceiptPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/receipt?ref=${encodeURIComponent(referenceCode)}`;
}
