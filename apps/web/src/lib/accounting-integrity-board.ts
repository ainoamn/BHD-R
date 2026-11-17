/** Client-safe types for the GL integrity board. */

export type IntegrityGap = {
  id: string;
  kind: 'payment_unposted' | 'cheque_unposted' | 'ar_variance' | 'draft_unbalanced';
  labelAr: string;
  labelEn: string;
  amountMinor: string | null;
  currency: string;
  ref: string;
};

export type IntegrityBoardPayload = {
  summary: {
    paymentUnposted: number;
    chequeUnposted: number;
    arVariance: number;
    draftUnbalanced: number;
  };
  gaps: IntegrityGap[];
};
