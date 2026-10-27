export function leaseSignPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/sign?ref=${encodeURIComponent(referenceCode)}`;
}

/** Opens the booking document for whoever may see it: the customer, or the landlord's staff. */
export function leaseBookingDocumentPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/document?ref=${encodeURIComponent(referenceCode)}`;
}

export function leaseConfirmedPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/confirmed?ref=${encodeURIComponent(referenceCode)}`;
}

/** Official arabon / booking-deposit receipt (same page for tenant and owner). */
export function leaseReceiptPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/book/receipt?ref=${encodeURIComponent(referenceCode)}`;
}
