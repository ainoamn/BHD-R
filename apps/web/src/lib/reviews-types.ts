export type ReviewTargetType = 'property' | 'party' | 'organization';

export type PublicReview = {
  id: string;
  targetType: ReviewTargetType;
  targetId: string;
  rating: number;
  body: string | null;
  verifiedStay: boolean;
  verifiedRole: string | null;
  authorPartyId: string | null;
  authorLabel: string;
  createdAt: string;
};

export type ReviewSummary = {
  avgRating: number | null;
  reviewCount: number;
  verifiedCount: number;
};
