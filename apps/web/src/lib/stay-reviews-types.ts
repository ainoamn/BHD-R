/** A departed stay the signed-in guest can still review (My trips). */
export type StayReviewPending = {
  bookingId: string;
  referenceCode: string;
  checkOutOn: string;
  titleAr: string;
  titleEn: string;
  coverImageUrl: string | null;
  daysLeft: number;
};
