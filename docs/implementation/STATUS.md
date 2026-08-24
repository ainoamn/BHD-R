# Implementation status

**Updated:** 2026-08-24  
**Active phase:** 1 — identity / security residuals (partial)  
**Product version:** 0.2.1

| Phase                    | Status      | Notes                                                            |
| ------------------------ | ----------- | ---------------------------------------------------------------- |
| 0 Baseline / GAP         | complete    | Gate green; `docs/verification/phase-0.md`                       |
| 1 Identity / security    | in_progress | TOTP recovery + `can()` done; F20 encryption backfill still open |
| 2 Parties                | pending     | Mostly complete — verify entitlement limit E2E                   |
| 3 Portfolio / media      | pending     | Mostly complete — SEO/Lighthouse budgets                         |
| 4 Viewing / booking      | pending     | Cheques depth; concurrency stress                                |
| 5 Contracts              | pending     | FSM docs + sequential signature regressions                      |
| 6 Finance / accounting   | pending     | FiscalPeriod; subscription depth                                 |
| 7 Maintenance / tasks    | pending     | Quote/warranty/auto-task uniqueness                              |
| 8 Legal                  | pending     | Expand beyond case+event                                         |
| 9 Portals / CMS / ETL    | pending     | CMS versioning; archive restore; OM ETL                          |
| 10 Perf / a11y / release | pending     | Load, CSP harden, CI security suite                              |

## Risks

- Production DB still needs migrate through `0008` + RLS re-apply before relying on recovery codes in prod.
- Enterprise command phases 2–10 still have documented residuals in GAP register.

## Next

Close F20 (encryption backfill) → Phase 2 entitlement E2E → continue sequentially.
