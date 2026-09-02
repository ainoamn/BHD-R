export type StayReviewPublic = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  prosText: string | null;
  consText: string | null;
  cleanliness: number | null;
  locationScore: number | null;
  valueScore: number | null;
  communication: number | null;
  accuracy: number | null;
  checkInScore: number | null;
  createdAt: string;
  authorLabel: string;
  propertyTitleAr: string | null;
  propertyTitleEn: string | null;
  coverImageUrl: string | null;
};

export type StayReviewPending = {
  bookingId: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  propertyId: string;
  unitId: string;
  slug: string | null;
  titleAr: string;
  titleEn: string;
  coverImageUrl: string | null;
  daysLeft: number;
};

export type StayReviewSubmitInput = {
  bookingId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  prosText?: string | null;
  consText?: string | null;
  cleanliness?: number | null;
  locationScore?: number | null;
  valueScore?: number | null;
  communication?: number | null;
  accuracy?: number | null;
  checkInScore?: number | null;
};
