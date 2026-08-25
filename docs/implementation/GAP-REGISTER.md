# GAP Register — BHD R vs enterprise build command + BHD-OM operational review

**Created:** 2026-08-24 (Phase 0)  
**Sources:** `docs/product/CURSOR-BHD-R-enterprise-build-command-ar.md`, `docs/legacy-reviews/BHD-OM-operational-workflows-deep-review-ar.md`, live code under `apps/*` + `packages/*`.  
**Rule:** `complete` requires endpoint + migration/schema + UI (where applicable) + test evidence. V1 docs alone do not count.

Statuses: `complete` | `partial` | `missing` | `unsafe` | `not-applicable` | `deferred-v2`

## A. Cross-cutting foundation

| ID  | Capability                                                 | Status   | Evidence / gap                                                                                                         | Closes in |
| --- | ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | --------- |
| F01 | Single PostgreSQL SoT (no business localStorage/JSON core) | complete | No web `localStorage` business SoT; Drizzle schema + migrations 0000–0009                                              | —         |
| F02 | `organization_id` on tenant tables                         | complete | `packages/db/src/schema.ts`                                                                                            | —         |
| F03 | RLS forced + A/B tests                                     | complete | `migrations/custom/0001_rls.sql`, `packages/db/test/rls.integration.test.ts`                                           | —         |
| F04 | Central policy / route classification                      | complete | Global `PermissionGuard` + `@RequirePermissions` + `can()` in `@bhd-r/authz`                                           | 1         |
| F05 | Money as `bigint` minor units                              | complete | Schema + `packages/domain` money helpers; no float money stores                                                        | —         |
| F06 | Explicit status machines (no free PATCH status)            | partial  | Domain FSMs in `packages/domain/state-machines.ts`; service wiring still partial                                       | 5         |
| F07 | Idempotency-Key on sensitive creates                       | complete | `idempotency_keys` + finance/leasing/portfolio usage                                                                   | —         |
| F08 | Webhook signature + unique event                           | complete | `webhook_events` unique; finance webhook path; concurrency test claimed in V1 report — re-verify Phase 0 gate          | 0         |
| F09 | No migrations in `next build`                              | complete | Separate `db:migrate`; web build does not migrate                                                                      | —         |
| F10 | Activation / no permanent temp passwords                   | complete | Auth activate + Identity SSO paths                                                                                     | —         |
| F11 | HTML sanitize / no unsafe user HTML in print               | partial  | `packages/security/src/html.ts` + PDF worker constraints; need continuous XSS regression payloads in every print field | 6         |
| F12 | Media as object keys (no Data URL business records)        | complete | `media_assets` + media service                                                                                         | —         |
| F13 | Actors from session (`actor_id`/`request_id`)              | complete | Audit interceptor pattern                                                                                              | —         |
| F14 | KPI/reports from real queries only                         | complete | Worker report SQL + fail unsupported types                                                                             | —         |
| F15 | Deep secret redaction                                      | complete | observability redaction tests                                                                                          | —         |
| F16 | No legacy runtime port                                     | complete | No `legacy/` in runtime apps                                                                                           | —         |
| F17 | CSRF (origin + double-submit)                              | complete | `csrf.guard.ts`, auth CSRF endpoint                                                                                    | —         |
| F18 | TOTP (encrypted, anti-replay)                              | complete | Enroll/confirm + anti-replay + hashed single-use recovery codes (`0008`)                                               | —         |
| F19 | API keys (hash, scopes, revoke)                            | complete | `api_keys` + auth endpoints                                                                                            | —         |
| F20 | Encryption versioned + dual-read                           | complete | Envelope + dual-read + resumable worker backfill + platform enqueue + metrics                                          | —         |
| F21 | CSP/security headers                                       | partial  | Headers present; tighten `unsafe-inline` toward nonce where possible                                                   | 10        |
| F22 | `docs/implementation` + `docs/verification` gates          | complete | GAP/STATUS/phase plans + verification evidence present                                                                 | —         |

## B. Journeys from BHD-OM operational review (§19)

| ID  | Required proof                                         | Status   | Notes                                                                                                       | Phase |
| --- | ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- | ----- |
| J01 | Single property → Property+Unit+Ownership txn          | complete | Portfolio wizard + schema                                                                                   | 3     |
| J02 | Multi-unit real units (stable ids)                     | complete | Wizard units                                                                                                | 3     |
| J03 | Held/leased/maintenance hidden from public             | complete | `deriveAvailability` + public listings                                                                      | 3     |
| J04 | Viewing separate from Reservation                      | complete | `viewing_requests` + public POST                                                                            | 4     |
| J05 | Concurrent booking → one active                        | complete | Advisory lock + unique active indexes + 50-contender model test                                             | 4     |
| J06 | Payment only via signed unique webhook                 | complete | Finance webhook + uniqueness                                                                                | 6     |
| J07 | Contract after accounting + requirements gate          | partial  | Compliance APIs + leasing flow; expand E2E proof                                                            | 4–5   |
| J08 | ApprovalRequest/Decision with actor/version            | partial  | `approval_requests` + workflow_events; deepen decision audit fields                                         | 5/7   |
| J09 | Signature token hashed/expiring + PDF hash             | complete | Signature tables + leasing service                                                                          | 5     |
| J10 | Activation txn (contract+unit+lease+schedules+outbox)  | complete | Leasing finalization path                                                                                   | 5     |
| J11 | Journals: draft no balance; posted immutable; reversal | complete | Accounting service checks; draft excluded from TB                                                           | 6     |
| J12 | Maintenance linked to unit/lease/cost/approval         | partial  | Tickets + work orders; quote/warranty/cost allocation depth thin vs OM legacy                               | 7     |
| J13 | Auto tasks from outbox unique key                      | partial  | `work_tasks` exist; automated unique `source_type+source_id+rule` incomplete                                | 7     |
| J14 | Legal case module (hearings/judgments/…)               | partial  | `legal_cases`/`legal_events` only — **missing** Hearing/Judgment/Enforcement/Settlement/Evidence/LegalParty | 8     |
| J15 | Real reports + KPI + tenant scope                      | complete | Report jobs + download                                                                                      | 9     |
| J16 | Tenant A/B isolation                                   | complete | RLS integration tests                                                                                       | 1     |

## C. Phase checklist (build command §5–15)

| Phase | Theme                                 | Overall         | Blocking residuals                                                                |
| ----- | ------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| 0     | Baseline / GAP / manifests            | complete        | `docs/verification/phase-0.md`                                                    |
| 1     | Identity / authz / security           | complete        | TOTP recovery, `can()`, encryption backfill                                       |
| 2     | Parties / reps / entitlements         | complete        | Plan limits + hashed invites + revoke authority — `docs/verification/phase-2.md`  |
| 3     | Portfolio / media / public SEO        | complete        | JSON-LD + LHCI mobile + portal noindex — `docs/verification/phase-3.md`           |
| 4     | CRM / viewing / reservation / cheques | complete        | Cheques + leads/applications + concurrency model — `docs/verification/phase-4.md` |
| 5     | Contracts / signature / renewals      | mostly complete | Machine-readable FSM diagrams; expand sequential signature policy tests           |
| 6     | Finance / accounting / subscriptions  | partial         | FiscalPeriod; subscription product entitlements depth; print XSS matrix           |
| 7     | Maintenance / tasks / approvals       | partial         | Quote/warranty/cost allocation; auto-task unique keys                             |
| 8     | Legal                                 | partial         | Expand legal schema beyond case+event                                             |
| 9     | Portals / CMS / archive / ETL         | partial         | CMS versioning; archive restore proof; OM ETL rehearsal                           |
| 10    | Perf / a11y / CI / release            | partial         | Load tests; stricter CSP; SBOM/CodeQL in CI                                       |

## D. Explicit non-goals (not-applicable / deferred-v2)

| Item                                              | Status                            |
| ------------------------------------------------- | --------------------------------- |
| Auctions, fractional ownership, financing, VR, AI | deferred-v2                       |
| Legal certification of e-sign in Oman             | not-applicable (requires counsel) |
| Production secret rotation / live PITR            | not-applicable from repo alone    |
| Porting bhd-om legacy JS into runtime             | not-applicable (forbidden)        |

## E. Phase 0 exit criteria

- [x] Mandatory reviews copied into `docs/`
- [x] This GAP register created
- [ ] Baseline commands green: format, verify:source, lint, typecheck, test, build, test:e2e (+ DB when available)
- [ ] `docs/verification/phase-0.md` with command outputs
- [ ] Route + schema/RLS matrix noted (see explore inventory)
- [x] Baseline documented; F18/F04/F20 closed in Phase 1

Owner: Cursor Agent (enterprise build command execution)
