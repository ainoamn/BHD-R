# Implementation status

**Updated:** 2026-08-25  
**Active phase:** OM ops steps 10–12 done; Nest host go-live pending credentials  
**Product version:** 0.2.10

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0 Baseline / GAP         | complete | `docs/verification/phase-0.md`                                                    |
| 1 Identity / security    | complete | `docs/verification/phase-1.md` + SSO verify/userinfo harden (0.2.6)             |
| 2 Parties                | complete | `docs/verification/phase-2.md`                                                    |
| 3 Portfolio / media      | complete | `docs/verification/phase-3.md`                                                    |
| 4 Viewing / booking      | complete | Cheques + leads + concurrency — `docs/verification/phase-4.md` + responsive audit |
| **OM ops flow**          | **active** | Steps 1–12 (11 scaffold); Nest public URL still required for live `/v1/*` |
| 5 Contracts              | pending  | Wire grace/cheques schedule + multi-approver to OM parity                         |
| 6 Finance / accounting   | **partial** | Auto journal on deposit confirm (step 8); FiscalPeriod still open              |
| 7 Maintenance / tasks    | **partial** | Vacancy auto-task on lease end (step 9); quote/warranty still open             |
| 8 Legal                  | pending  | Expand schema                                                                     |
| 9 Portals / CMS / ETL    | **partial** | Party-scoped portal metrics (step 10); CMS/ETL still open                      |
| 10 Perf / a11y / release | pending  | Load/CSP/CI                                                                       |

## Next

1. Provision Nest host from `docs/implementation/NEST-API-HOSTING.md` + set Vercel `API_INTERNAL_ORIGIN`.  
2. Rotate Neon password (exposed in chat) and refresh `DATABASE_URL`.  
3. Optional: auto-open maintenance/legal from vacancy checklist.

## Verification

- OM steps 1–12: `docs/verification/om-ops-flow.md`
- Flow map: `docs/implementation/OPS-FLOW-FROM-BHD-OM.md`
- Nest hosting: `docs/implementation/NEST-API-HOSTING.md`
