# Implementation status

**Updated:** 2026-08-25  
**Active phase:** Cycle rules v1.1 **implemented in code** (migration `0011` required on Neon); Nest URL + Vercel env still human  
**Product version:** 0.2.15  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.2**

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0–4                      | complete | Phases 0–4 verified                                                               |
| **OM ops flow**          | **active** | Steps 1–19 coded; Nest public URL + Vercel `API_INTERNAL_ORIGIN` still manual |
| **Cycle rules v1.1**     | **coded** | R1 cancel clearance, R3 renewal gate, R4/R5 ownership+lease transfer — apply DB migration `0011_lease_cycle_v11` |

## Next (human)

1. Run DB migration `0011_lease_cycle_v11` on Neon (or `pnpm --filter @bhd-r/db migrate`).  
2. **`docs/implementation/VERCEL-MANUAL-AR.md`** after Nest HTTPS exists.  
3. Nest host: `docs/implementation/NEST-API-HOSTING.md` / `render.yaml`.  
4. Rotate Neon password → refresh `DATABASE_URL`.

## Next (product polish)

1. Auto-create renewal cheque schedule rows when addendum is created (R3 completeness).  
2. Stronger deposit مخالصة checklist before `clear_cancellation` (R2).  
3. Property archive/reactivate UX under new owner.

## Verification

- `docs/verification/om-ops-flow.md`
- `docs/implementation/VERCEL-MANUAL-AR.md`
- `docs/implementation/TRANSACTION-FLOW-MAP.html` (open in browser)
