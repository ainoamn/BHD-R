# Operational flow: BHD-OM → BHD-R

**Source of truth (behavior):** `C:\dev\bhd-om` legacy ops.  
**Implementation:** BHD-R Nest API + web ops console.  
**Updated:** 2026-08-25

## Hard rules

1–15 as previously documented, plus:
16. Bookings row exposes accountant **Confirm deposit** and post-confirm links (lease convert + ledger).
17. Ops context exposes `vacancyFollowUps` counts; console shows vacancy pipeline strip.

## Phase checklist

| Step | Status |
|------|--------|
| 1–15 | **Wired** |
| 16 Deposit confirm visible in bookings UI | **Wired** |
| 17 Vacancy follow-up pipeline strip | **Wired** |
| 11 Nest host | **Scaffolded** — human: `VERCEL-MANUAL-AR.md` |

## Deploy note

`docs/implementation/VERCEL-MANUAL-AR.md` for `API_INTERNAL_ORIGIN`.
