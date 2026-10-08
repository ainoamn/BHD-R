/** Daily-rental settings of one unit (property edit page, stays rates page). Money in minor units. */
export type PropertyStaySettingsUnit = {
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string;
  unitId: string;
  unitCode: string;
  unitNameAr: string;
  unitNameEn: string;
  profileId: string;
  publishStatus: string;
  listingSlug: string | null;
  currency: string;
  minorUnit: number;
  overnightMaxGuests: number;
  dayUseMaxGuests: number | null;
  minNights: number;
  maxNights: number;
  instantBook: boolean;
  checkInFrom: string | null;
  dayUseCheckOutUntil: string | null;
  overnightCheckOutUntil: string | null;
  depositMinor: string | null;
  baseNightlyMinor: string | null;
  weekendNightlyMinor: string | null;
  dayUseMinor: string | null;
  overnightOnlyMinor: string | null;
};
