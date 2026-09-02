# Handoff — Stay setup policies & period times (0.4.33)

**Date:** 2026-09-02  
**Production:** https://r.bhd-om.com

## Goal

Owner stay setup no longer asks for a new description; it captures period check-in/out times, guest caps, policies/instructions, deposit, and three rate types.

## Shipped

- Wizard steps: `units → rules → pricing → publish`
- Schema + Neon migration `0021_stay_profile_policies`
- Public stay detail shows times, guest caps, deposit, policies, instructions
- Listing upsert on publish uses property description

## Key files

- `apps/web/src/components/stays/stay-setup-wizard.tsx`
- `apps/web/src/lib/stay-setup-neon.ts`
- `packages/db/migrations/custom/0021_stay_profile_policies.sql`
- `packages/contracts/src/stays/setup-schemas.ts`
- `apps/web/src/components/stays/stay-public-showcase.tsx`

## Note

Do not commit `packages/db/tmp-migrate-0021.mjs` or `.env.neon`.
