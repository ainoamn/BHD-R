# Implementation status

**Updated:** 2026-08-25  
**Active phase:** OM steps 1–15 in code; Nest URL + Vercel env still human  
**Product version:** 0.2.12

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0 Baseline / GAP         | complete | `docs/verification/phase-0.md`                                                    |
| 1 Identity / security    | complete | `docs/verification/phase-1.md` + SSO verify/userinfo harden (0.2.6)             |
| 2 Parties                | complete | `docs/verification/phase-2.md`                                                    |
| 3 Portfolio / media      | complete | `docs/verification/phase-3.md`                                                    |
| 4 Viewing / booking      | complete | Cheques + leads + concurrency — `docs/verification/phase-4.md` + responsive audit |
| **OM ops flow**          | **active** | Steps 1–15 coded; Nest public URL + Vercel `API_INTERNAL_ORIGIN` still manual |
| 5 Contracts              | pending  | FiscalPeriod / deeper contract CMS                                                |
| 6 Finance / accounting   | **partial** | Deposit journal + vacancy settlement expense                                   |
| 7 Maintenance / tasks    | **partial** | Vacancy auto task + maintenance                                                |
| 8 Legal                  | **partial** | Vacancy deposit review case                                                    |
| 9 Portals / CMS / ETL    | **partial** | Party-scoped metrics; CMS/ETL open                                             |
| 10 Perf / a11y / release | pending  | Load/CSP/CI                                                                       |

## Next (human)

1. **`docs/implementation/VERCEL-MANUAL-AR.md`** after Nest HTTPS exists.  
2. Nest host: `docs/implementation/NEST-API-HOSTING.md` / `render.yaml`.  
3. Rotate Neon password → refresh `DATABASE_URL`.

## Verification

- OM flow: `docs/verification/om-ops-flow.md`
- Vercel manual: `docs/implementation/VERCEL-MANUAL-AR.md`
