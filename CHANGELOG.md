# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first production release.

## 0.2.21 — 2026-08-25

- Property wizard UX: 7 steps with slide transitions; bilingual name/description pairs; amenity icons; rainbow/red progress dots.
- Google Maps required link + interactive map picker (Leaflet) that fills URL and coordinates.
- Auto read-only unit codes; empty required dropdowns for floor/beds/baths; owner-private optional docs (deed / survey / owner ID); min two photos; booking-style final listing preview.
- CSRF: browser mutations via Next BFF `/api/backend/v1/*`; Nest allows configured/preview origins and same-site Fetch Metadata.
- Docs: `docs/implementation/PROPERTY-WIZARD-AR.md`, `NEST-API-HOSTING.md` (BFF notes).

## 0.2.20 — 2026-08-25

- Fix Vercel TypeScript build (`exactOptionalPropertyTypes` on listing preview `area`/`coverUrl`).
- Property wizard labels moved into i18n (AR/EN) including steps, categories, and publish hints; tighter mobile wizard layout.

## 0.2.19 — 2026-08-25

- Property wizard redesign: numbered gated steps, required field tones, Oman gov→wilayat→village cascade, expanded amenities + custom, media icons/cover, AI-assisted bilingual description, homepage listing preview.
- Property serials `BHD-YYYY-PRP-*` via migration `0012_property_serials`; media complete accepts `position` for cover ordering.
- Docs: `docs/implementation/PROPERTY-WIZARD-AR.md`.

## 0.2.18 — 2026-08-25

- Portal chrome redesign for owner/developer/tenant/platform: sticky header with user identity, bilingual switch, BHD app switcher; grouped sidebar nav.
- Responsive drawer (RTL-aware) for phones/tablets; ops tables scroll horizontally on narrow viewports.
- Latin UI font: IBM Plex Sans (paired with IBM Plex Sans Arabic).
- Docs: `docs/implementation/PORTAL-CHROME-AR.md`.

## 0.2.6 — 2026-08-25

- Unified login alignment with BHD Identity: `/login` always starts OIDC on `id.bhd-om.com` (local password only via `?local=1`).
- Callback OAuth state cookie `Path=/`, sealed `redirectUri` at `/start` (Nasab/WAZEN pattern).
- Identity token verify moved into `apps/web` (`verify-id-token.ts`): access_token HS256 bind → `/oauth/userinfo` → id_token HS256; null-tolerant userinfo; error detail in `?x=`.
- Applied missing Neon column `users.totp_recovery_digests` (migration `0008`) which broke post-verify user load.
- Clearer `?bhd=` error codes and compact error UI (no product-hosted identity clone).
- Ops: `scripts/fix-vercel-identity-env.mjs` + `.vercelignore`; transpile `@bhd-r/authz`/`db`/`security` in Next.
- Docs: `BHD-PRODUCT-SSO-ADMIN` checklist — `bhd-r` flipped to `mode=sso` on Identity catalog.

## 0.2.2 — 2026-08-24

- Phase 1 complete: resumable field-encryption backfill worker (encryption.backfill) + platform enqueue API.
- Domain state machines for reservation/contract/journal/maintenance (packages/domain).

## 0.2.1 — 2026-08-24

- Enterprise build Phase 0: archived OM operational review + Cursor build command; GAP register and baseline verification (`docs/verification/phase-0.md`).
- Phase 1 progress: TOTP hashed recovery codes (migration `0008`), login accepts recovery or TOTP, `can()` policy helper in `@bhd-r/authz`.

## 0.2.0 — 2026-08-24

- V1 operational core complete: property wizard through leases, dual-party signature, renewals (independent addenda), tenant activation, billing/refunds, double-entry accounting, maintenance/legal/sales/approvals, and signed reports.
- New portal surfaces for owner/developer bookings & contracts, tenant reservations/compliance, public viewing requests, and sandbox payments.
- Parties/CRM module, default contract template, migrations `0003`–`0007`, expanded RLS/roles, and full verification evidence in `docs/V1-COMPLETION-REPORT-AR.md`.
- Production cutover still requires backup, migrate `0003`–`0007`, re-apply RLS/runtime roles, secrets, then API+Worker+Web canary smoke (not claimed done by this tag alone).
- Workspace inventory of `Codex/2026-08-11`: `docs/CODEX_WORKSPACE_2026-08-11_AR.md`; local export `BHD-R-complete-0.2.0` supersedes `0.1.6` packages (do not overwrite live repo with older zips).

## 0.1.6 — 2026-08-24

- Owner/developer/tenant portal mobile shell: sticky bar + slide-out drawer navigation (RTL-aware).
- Fixed restricted worker SQL grants for generated reports and added a live PostgreSQL contract test for every report query.
- Corrected maintenance, legal, task, expense, and trial-balance report queries; draft journal entries no longer affect the trial balance.
- Unsupported report requests now transition to `failed` instead of remaining stuck in `running`.
- Expanded tenant-isolation regression coverage to operational requests and cross-organization sales deals.
- Clarified the deterministic browser E2E job while retaining live database/RLS integration gates in CI.
- Verified `BHD-R-complete-0.1.6` package against repo (content match); sync notes in `docs/RELEASE_SYNC_0.1.6.md`.
- Archived parent-folder assets into repo: system screenshots, OG source, phase-0 specs, BHD-OM inventory CSVs (`docs/PARENT_FOLDER_SYNC_AR.md`).
- Operations suite doc refreshed for 0.1.6 (portal mobile shell, signed report download, cross-links).

## 0.1.5 — 2026-08-24

- Login brand panel: unified «بوابة BHD» gateway copy (Arabic + English).
- Secure report download: `GET /v1/reports/:id/download` (signed S3 URL) + operations console action.
- Operations suite documentation: `docs/OPERATIONS_SUITE_AR.md` and README link.
- SSO hardening docs refresh; OIDC env values sanitized (issuer/client_id newlines); Turbo `globalPassThroughEnv`.
- Locale typing fix for operations workspace (`"ar" | "en"`) so Vercel `next build` typecheck passes.

## 0.1.4 — 2026-08-23

- Operations and accounting portal modules (requests, sales, expenses, journals, work orders).
- Schema migrations `0001`/`0002` plus RLS updates for new tables.
- Property wizard and portal navigation wired to operations workspace.
- Identity HS256 verify falls back to `/oauth/userinfo` when product secret is corrupt.

## 0.1.3 — 2026-08-23

- Live SSO session minting on Vercel via `DATABASE_URL` (Neon) without requiring Nest for callback.
- Identity token verify aligned with Nasab/WAZEN: alg-aware HS256 + `/oauth/userinfo` fallback.
- Portal footer programmes row matched to www.bhd-om.com; client `bhd-r` registered on ONE-BHD.
- Viewer resolution from Host-only session cookie when DB is configured.
- Docs: `BHD-R-SSO-COMPLIANCE`, identity setup (Neon project + `?bhd=` error codes).

## 0.1.2 — 2026-08-23

- Canonical BHD product SSO: `/api/auth/bhd/start|callback|logout` and `/api/auth/admin-entry`.
- Login wrapper redirects to Identity except emergency `?local=1`; admin paths use `admin-entry`.
- Identity linking per §0.7/`identity_subject`; Nest `POST /v1/auth/identity/session` for web-origin cookies.
- Frozen app-switcher catalog, unified logout via end-session, footer «برامجنا» + admin entry.
- Docs: `BHD-PRODUCT-SSO-ADMIN`, unified login copy with §12.9, `BHD-R-SSO-COMPLIANCE`, updated identity setup.

## 0.1.1 — 2026-08-23

- Omani visual redesign for the public site and unified login (fort and Al Alam imagery, official BHD mark, Oman flag accent bar).
- ONE-BHD-style login shell with primary OIDC handoff to BHD Identity.
- BHD app switcher and account menu after sign-in.
- WebP + `next/image` media; expanded E2E coverage for header, login, and responsive shells.
- TypeScript fix for optional identity token secret forwarding.
- See `docs/OMANI_UI_2026-08-23.md`.

## 0.1.0 — 2026-08-23

- Initial BHD R modular-monolith foundation.
- Arabic/English public site and separated platform, owner, developer, and tenant portals.
- Organization-scoped properties, first-class units, listings, reservations, leases, contracts, invoices, payments, maintenance, reports, and media.
- Central permission model, tenant isolation, audit redaction, CSRF, idempotency, SSRF protection, versioned encryption, TOTP, and API-key primitives.
- Gulf country packs and exact currency minor-unit handling.
- Durable media/PDF/notification worker, Docker development stack, CI security gates, and operational documentation.
- Production-validated PostgreSQL migrations and tenant-isolation regression tests with non-superuser roles.
- Restricted media CSP, HSTS, item-specific social metadata, and an original bilingual Open Graph card.
- Updated dependency and runtime verification gates with a clean package-security audit.
- Pruned production-only Docker images and split database migrations into a least-privilege image.
