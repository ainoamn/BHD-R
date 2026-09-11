import type { OpsStayBooking } from '@/components/stays/stay-ops-bookings-table';

export type BookingPurposeTab = 'all' | 'daily' | 'monthly' | 'yearly' | 'sale';

export const BOOKING_PURPOSE_TABS: Array<{
  id: BookingPurposeTab;
  ar: string;
  en: string;
}> = [
  { id: 'all', ar: 'الكل', en: 'All' },
  { id: 'daily', ar: 'يومي', en: 'Daily' },
  { id: 'monthly', ar: 'شهري', en: 'Monthly' },
  { id: 'yearly', ar: 'سنوي', en: 'Yearly' },
  { id: 'sale', ar: 'بيع', en: 'Sale' },
];

export function resolveBookingPurpose(row: Record<string, unknown>): Exclude<BookingPurposeTab, 'all'> {
  if (String(row.recordKind ?? '') === 'stay_booking') return 'daily';
  const tagged = String(row.bookingPurpose ?? '').toLowerCase();
  if (tagged === 'daily' || tagged === 'monthly' || tagged === 'yearly' || tagged === 'sale') {
    return tagged;
  }
  const listing = String(row.listingPurpose ?? '').toLowerCase();
  if (listing === 'sale') return 'sale';
  if (listing === 'both') return 'monthly';
  const modes = String(row.offeringModes ?? row.offering_modes ?? '').toLowerCase();
  if (modes.includes('sale') && !modes.includes('monthly') && !modes.includes('yearly')) {
    return 'sale';
  }
  if (modes.includes('yearly') && !modes.includes('monthly')) return 'yearly';
  if (modes.includes('daily') && !modes.includes('monthly') && !modes.includes('yearly')) {
    return 'daily';
  }
  return 'monthly';
}

/** Viewings appear on long-term tabs; stay bookings only on daily. */
export function matchesBookingPurposeTab(
  row: Record<string, unknown>,
  tab: BookingPurposeTab,
): boolean {
  if (tab === 'all') return true;
  const kind = String(row.recordKind ?? '');
  if (tab === 'daily') return kind === 'stay_booking' || resolveBookingPurpose(row) === 'daily';
  if (kind === 'stay_booking') return false;
  if (kind === 'viewing') return tab === 'monthly' || tab === 'yearly' || tab === 'sale';
  return resolveBookingPurpose(row) === tab;
}

export function opsRowToStayBooking(row: Record<string, unknown>): OpsStayBooking | null {
  if (String(row.recordKind ?? '') !== 'stay_booking') return null;
  const id = String(row.id ?? '');
  if (!id) return null;
  return {
    id,
    referenceCode: String(row.referenceCode ?? row.reference ?? id),
    propertyId: String(row.propertyId ?? ''),
    unitId: String(row.unitId ?? ''),
    checkInOn: String(row.checkInOn ?? row.scheduledAt ?? ''),
    checkOutOn: String(row.checkOutOn ?? row.expiresAt ?? ''),
    status: String(row.status ?? ''),
    bookingMode: String(row.bookingMode ?? 'request_to_book'),
    ...(typeof row.source === 'string' ? { source: row.source } : {}),
    currency: String(row.currency ?? 'OMR'),
    totalMinor: String(row.totalMinor ?? '0'),
    ...(typeof row.nights === 'number' ? { nights: row.nights } : {}),
    ...(typeof row.propertyNameAr === 'string' ? { propertyNameAr: row.propertyNameAr } : {}),
    ...(typeof row.propertyNameEn === 'string' ? { propertyNameEn: row.propertyNameEn } : {}),
    ...(typeof row.unitCode === 'string' ? { unitCode: row.unitCode } : {}),
    ...(typeof row.unitNameAr === 'string' ? { unitNameAr: row.unitNameAr } : {}),
    ...(typeof row.unitNameEn === 'string' ? { unitNameEn: row.unitNameEn } : {}),
    ...(typeof row.guestDisplayName === 'string' ? { guestDisplayName: row.guestDisplayName } : {}),
  };
}
