# Implementation status

**Updated:** 2026-08-25  
**Active phase:** OM ops flow steps 8–9 complete; Nest host remaining  
**Product version:** 0.2.8

| Phase                    | Status   | Notes                                                                             |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| 0 Baseline / GAP         | complete | `docs/verification/phase-0.md`                                                    |
| 1 Identity / security    | complete | `docs/verification/phase-1.md` + SSO verify/userinfo harden (0.2.6)             |
| 2 Parties                | complete | `docs/verification/phase-2.md`                                                    |
| 3 Portfolio / media      | complete | `docs/verification/phase-3.md`                                                    |
| 4 Viewing / booking      | complete | Cheques + leads + concurrency — `docs/verification/phase-4.md` + responsive audit |
| **OM ops flow**          | **active** | Steps 1–9 wired in API/ops UI — Nest `API_ORIGIN` still required on Vercel |
| 5 Contracts              | pending  | Wire grace/cheques schedule + multi-approver to OM parity                         |
| 6 Finance / accounting   | **partial** | Auto journal on deposit confirm (step 8); FiscalPeriod still open              |
| 7 Maintenance / tasks    | **partial** | Vacancy auto-task on lease end (step 9); quote/warranty still open             |
| 8 Legal                  | pending  | Expand schema                                                                     |
| 9 Portals / CMS / ETL    | pending  | CMS/archive/ETL                                                                   |
| 10 Perf / a11y / release | pending  | Load/CSP/CI                                                                       |

## Next

1. Deploy Nest API and set `API_INTERNAL_ORIGIN` on Vercel.  
2. Party-scoped portal overview metrics.  
3. Rotate Neon password (exposed in chat) and refresh `DATABASE_URL`.

## Verification

- OM steps 1–9: `docs/verification/om-ops-flow.md`
- Flow map: `docs/implementation/OPS-FLOW-FROM-BHD-OM.md`

## 0.2.6+ ops note

Production SSO: credentials only on `https://id.bhd-om.com`; product `/api/auth/bhd/start|callback|logout`.  
Env hygiene: never pipe secrets into `vercel env add` from PowerShell without stripping `\r\n` — use `scripts/fix-vercel-identity-env.mjs`.
