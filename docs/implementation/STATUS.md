# Implementation status

**Updated:** 2026-08-25  
**Active phase:** OM steps 1–13 in code; Vercel manual Nest wiring pending human  
**Product version:** 0.2.11

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0 Baseline / GAP         | complete | `docs/verification/phase-0.md`                                                    |
| 1 Identity / security    | complete | `docs/verification/phase-1.md` + SSO verify/userinfo harden (0.2.6)             |
| 2 Parties                | complete | `docs/verification/phase-2.md`                                                    |
| 3 Portfolio / media      | complete | `docs/verification/phase-3.md`                                                    |
| 4 Viewing / booking      | complete | Cheques + leads + concurrency — `docs/verification/phase-4.md` + responsive audit |
| **OM ops flow**          | **active** | Steps 1–13 coded; Nest public URL + Vercel `API_INTERNAL_ORIGIN` still manual |
| 5 Contracts              | pending  | Wire grace/cheques schedule + multi-approver to OM parity                         |
| 6 Finance / accounting   | **partial** | Auto journal on deposit confirm (step 8); FiscalPeriod still open              |
| 7 Maintenance / tasks    | **partial** | Vacancy auto task + maintenance + legal (steps 9/13)                           |
| 8 Legal                  | **partial** | Auto vacancy deposit review case (step 13)                                     |
| 9 Portals / CMS / ETL    | **partial** | Party-scoped portal metrics (step 10); CMS/ETL still open                      |
| 10 Perf / a11y / release | pending  | Load/CSP/CI                                                                       |

## Next (human)

1. Follow **`docs/implementation/VERCEL-MANUAL-AR.md`** after Nest HTTPS exists.  
2. Provision Nest via `docs/implementation/NEST-API-HOSTING.md` / `render.yaml`.  
3. Rotate Neon password and update `DATABASE_URL` on Vercel (+ Nest host).

## Verification

- OM flow: `docs/verification/om-ops-flow.md`
- Vercel manual (Arabic): `docs/implementation/VERCEL-MANUAL-AR.md`
- Nest hosting: `docs/implementation/NEST-API-HOSTING.md`
