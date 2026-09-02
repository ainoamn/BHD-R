# Handoff — Smart stay reviews + policies on stay page (0.4.35)

**Date:** 2026-09-02  
**Production:** https://r.bhd-om.com

## Shipped

- `StayGuestInfoSection` on live Property 360 stay pages (policies, rates, times, deposit, smart score).
- Rich `stay_reviews` + Booking-style `StayReviewsHub` / `GuestPendingStayReviews`.
- AI draft assist (deterministic, score/keyword based).
- Dual-write to property `reviews` for score chip continuity.
- Migration `0022_stay_reviews_rich`.

## Key files

- `apps/web/src/components/stays/stay-guest-info-section.tsx`
- `apps/web/src/components/stays/stay-reviews-hub.tsx`
- `apps/web/src/lib/stay-reviews-neon.ts`
- `apps/web/src/app/api/public/stays/reviews/**`
