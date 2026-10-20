export type ViewingGuestDecision = 'book_rent' | 'book_sale' | 'declined';

export type ViewingRequestDetail = {
  id: string;
  reference: string;
  status: string;
  channel: string;
  notes: string | null;
  preferredAt: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  unitId: string;
  unitCode: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  prospectPartyId: string;
  prospectName: string;
  prospectEmail: string | null;
  prospectPhone: string | null;
  canManage: boolean;
  accessUsername: string | null;
  accessPin: string | null;
  arrivedAt: string | null;
  guestDecision: ViewingGuestDecision | null;
  guestDecisionAt: string | null;
  /** Guest QR path once scheduled (relative, locale-prefixed by caller). */
  passPath: string | null;
  gatePath: string | null;
  /** Building viewing contact (guard) set on the property page. */
  viewingContactUserId: string | null;
  viewingContactName: string | null;
  viewingContactPhone: string | null;
  /** Human-readable property address for directions. */
  propertyAddress: string | null;
  /** Google Maps link from the property pin / saved maps URL. */
  propertyMapsUrl: string | null;
  /** False until the property has a viewing contact — schedule stays locked. */
  canSchedule: boolean;
};

export type ViewingGuestPass = {
  id: string;
  reference: string;
  status: string;
  scheduledAt: string | null;
  arrivedAt: string | null;
  accessUsername: string;
  accessPin: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  unitCode: string;
  unitId: string;
  propertyId: string;
  prospectName: string;
  guestDecision: ViewingGuestDecision | null;
  token: string;
  listingPurpose: 'rent' | 'sale' | 'both';
  contactName: string | null;
  contactPhone: string | null;
  propertyAddress: string | null;
  propertyMapsUrl: string | null;
};
