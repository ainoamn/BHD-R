# Implementation status

**Updated:** 2026-08-25  
**Active phase:** OM steps 1–19 in code; cycle rules v1.1 documented; Nest URL + Vercel env still human  
**Product version:** 0.2.14  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.1** (approved business rules R1–R5)

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0–4                      | complete | Phases 0–4 verified                                                               |
| **OM ops flow**          | **active** | Steps 1–19 coded; Nest public URL + Vercel `API_INTERNAL_ORIGIN` still manual |
| **Cycle rules v1.1**     | **documented** | Cancel request→admin→accountant; renewal cheque/invoice gate; in-system ownership transfer; sale of leased unit allowed — **code gaps listed in flow map §د** |

## Next (human)

1. **`docs/implementation/VERCEL-MANUAL-AR.md`** after Nest HTTPS exists.  
2. Nest host: `docs/implementation/NEST-API-HOSTING.md` / `render.yaml`.  
3. Rotate Neon password → refresh `DATABASE_URL`.

## Next (product / code — from flow map 1.1)

1. Cancellation request workflow + accountant clearance before tenant sees cancelled.  
2. Renewal: signed addendum → cheques + invoice settlement + accountant (manager exception).  
3. On `closed_won`: ownership transfer + prior-owner history; lease rights follow new owner if unit leased.

## Verification

- `docs/verification/om-ops-flow.md`
- `docs/implementation/VERCEL-MANUAL-AR.md`
- `docs/implementation/TRANSACTION-FLOW-MAP.html` (open in browser)
