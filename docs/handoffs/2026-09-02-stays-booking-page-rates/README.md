# Handoff — 0.4.31 stay booking UX + rate types

**Date:** 2026-09-02  
**Release:** 0.4.31  
**Commit:** `b101547`  
**Production:** https://r.bhd-om.com  
**Repo:** https://github.com/ainoamn/BHD-R  

## Shipped

- Smart money formatting (no fractional digits unless needed)
- Fix public hold/book failure (`Date` passed to raw SQL `expires_at`)
- Dedicated booking page `/[locale]/stays/[slug]/book`
- Three stay rate types in setup + guest checkout: overnight stay / day use / overnight only
- Neon migration `0020_stay_rate_types.sql` (already applied on production Neon)

## Do not commit

- `scripts/set-database-url.mjs` (local secrets helper)

## Verify after Vercel deploy

1. Calendar prices show `٣٥٠` not `٣٥٠٫٠٠٠`
2. Property page → «متابعة الحجز» opens `/stays/.../book`
3. Confirm booking succeeds (no «تعذّر إكمال الحجز»)
4. Owner setup pricing shows three rate fields
