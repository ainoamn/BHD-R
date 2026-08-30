# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first production release.

## 0.2.84 — 2026-08-30

- Client-safe error redaction (P2-04); CSRF origin harden + complete checkout CSRF; viewing/booking idempotency keys; Nest-first property deposit endpoint with Neon fallback; policy test requires CSRF.
- Docs: `RELEASE-0.2.84-AR.md`.

## 0.2.83 — 2026-08-30

- Next write-route policy test; Nest-first viewing with Neon fallback; rate limits on viewing/booking/translate/media; public media via `app.public`; Vercel API origin fail-closed (no Host spoof); cron timing-safe auth + ensure script; worker Sharp tests for disabled/best-effort scan modes.
- Docs: `RELEASE-0.2.83-AR.md`.

## 0.2.82 — 2026-08-30

- Soft-promote magic-bytes media for public gallery when worker offline (`MEDIA_PUBLIC_PROMOTE_MODE`); encryption backfill fail-closed (P1-06); Render/env manifest gaps (P1-07); expire-locks cron + catalogue reservation expiry; translate + sandbox complete live-session/CSRF.
- Docs: `RELEASE-0.2.82-AR.md`, `ENV-MANIFEST.md`.

## 0.2.81 — 2026-08-30

- Security follow-through: TOTP re-enroll step-up (P1-01); OIDC JWKS + host/leak fixes (P1-03); media upload stays `queued`/`pending` with `media.uploaded` outbox (P0-03); deposit GUCs + org-scoped public booking writes (P1-04); Express API e2e + honest chromium fixture CI label (P1-05).
- Docs: `RELEASE-0.2.81-AR.md`.

## 0.2.80 — 2026-08-30

- Next write routes: live session + CSRF (`requireLiveSession`); media magic-bytes + private-only storage (no prod Base64); expire timed-out holds/reservations before booking; S3 object delete on gallery remove.
- Docs: `RELEASE-0.2.80-AR.md`.

## 0.2.79 — 2026-08-30

- Security (review P0-01 / P0-04 / P2-01): disable booking sandbox complete in production; fail-closed session secrets; cron warmup requires `CRON_SECRET` and no longer returns origin/body.
- Soft navigation: property manage hub + listing cards + site header use `Link` prefetch; longer public/owner media cache headers.
- Docs: full architecture/security review archived under `docs/security/`; release notes `RELEASE-0.2.79-AR.md`.

## 0.2.78 — 2026-08-30

- Property wizard: «إزالة الصورة» now DELETE `/api/owner/media/:id` so existing gallery photos are removed from Neon (not only local React state).

## 0.2.77 — 2026-08-30

- Catalogue fix: raw-SQL Neon search (heal + list from `publish_when_available` in one privileged txn); `GET /api/public/catalogue` diagnostics; cards link to `/properties/:id` when `propertyId` is present.

## 0.2.76 — 2026-08-30

- Catalogue: list by `publishWhenAvailable` (not only `listings.enabled`); relax unit status; country filter optional + OM/OMN alias.
- Share copy: polished listing blurb + description + “visit the link” (AR/EN) instead of a dry title+URL.

## 0.2.75 — 2026-08-30

- Mobile property page: summary card (QR / price / book / share) moves to the **bottom** so gallery and details come first.

## 0.2.74 — 2026-08-30

- Public listing: hide URL under QR (keep center brand mark); move share to icon row below booking CTAs.

## 0.2.73 — 2026-08-30

- Public property page: QR + direct share (WhatsApp, Facebook, X, Telegram, LinkedIn, Instagram/native, copy link).
- Catalogue `/properties`: heal publish flags + privileged read so reserved/held units still appear (with status watermark) instead of vanishing via RLS.

## 0.2.72 — 2026-08-30

- Rename unit **التأمين** → **مبلغ العربون / الحجز** in property edit (units step), with checkout hint; remove deposit editor from manage hub (set it in Edit property settings).

## 0.2.71 — 2026-08-30

- Fix overlapping portal header: remove duplicate user avatar next to BHD app switcher; text-only identity chip + single account avatar; no wrap on chrome actions.

## 0.2.70 — 2026-08-30

- Owner/developer portal soft navigation: ops sections load via client memory cache + background warm (`/api/portal/ops/...`), so sidebar clicks paint like already-open views (WAZEN-style).
- Idle prefetch warms JSON payloads (not only RSC); `staleTimes` raised; removed portal-main enter animation that felt like a full reload.

## 0.2.69 — 2026-08-30

- Owner property page is an **ops hub** (stats, alerts, deposit, action buttons) — no public listing layout.
- Ops sections accept `?propertyId=` to show only that property’s contracts / leasing / sales / bookings / maintenance / invoices.
- Catalogue cards show market-status watermark (available / for rent / for sale / reserved / leased / sold).
- Public listing CTAs: **طلب معاينة** (login required) and **احجز الآن** → deposit checkout (`/book/:unitId`); owner sets deposit on manage hub.

## 0.2.68 — 2026-08-30

- Public `/units/:id` uses the same Property 360 showcase as owner/admin preview (`PropertyDetailManager` public), with focused unit pricing, gallery preference, and inline viewing request form.

## 0.2.67 — 2026-08-30

- Owner portfolio: each property row shows **عرض العقار** (public listing) and **إدارة العقار** (Property 360). Manage page adds an Operations strip with Edit + links to contracts, leasing, sales, bookings, maintenance, and invoices.

## 0.2.66 — 2026-08-30

- Public catalogue photos: use relative `/api/public/media/:id` so Next/Image accepts them (absolute same-origin URLs caused broken covers).
- Unit detail `/units/:id`: load from Neon when Nest fails; show gallery + BHD logo watermark on listing/gallery photos.
- Nest public unit: stringify `areaSquareMeters`; map inline Neon media to the public media BFF URL.

## 0.2.65 — 2026-08-30

- Replace the circular serif “R” placeholder with the official BHD wordmark + R badge (`BrandMark`) in empty states, loading, listing/gallery placeholders, and ops empty tables. See [`docs/ASSETS.md`](./docs/ASSETS.md).

## 0.2.64 — 2026-08-30

- Fix public catalogue: sync `listings.enabled`/`publishedAt` when «عرض الوحدة عند توفرها» is saved; heal on Property 360 open; `/properties` and home load listings from Neon when Nest is empty.

## 0.2.63 — 2026-08-30

- Owner Property 360: «عرض العقار» opens the public listing; QR encodes `/[locale]/properties/:id` (read-only marketing view, no edit/ownership). Public gallery via `/api/public/media/:id`.

## 0.2.62 — 2026-08-30

- Property 360: amenities in a fixed 3-column grid; unit facts show bed/bath/area/price icons; QR centers the BHD brand mark (high ECC).

## 0.2.61 — 2026-08-30

- Portfolio metrics/stages: denser cards + collapsible panel (folded by default on phone).
- Property 360: QR moved to top of summary and scaled down; fluid type for facts/price across viewports.

## 0.2.60 — 2026-08-30

- Property photos: store via Neon inline when R2 buckets are empty/misconfigured; gallery always streams through `/api/owner/media/:id` (stop using R2 API host as image URL); surface upload failures in the wizard.

## 0.2.59 — 2026-08-30

- Unified adaptive layout for all owner property surfaces (list, new, 360, edit): fluid type/icons/controls by viewport; phone cards + compact wizard; desktop table + full step rail.
- Docs: [`PORTAL-ADAPTIVE-PROPERTIES-AR.md`](./docs/implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md) + [`RESPONSIVE-0.2.59.md`](./docs/verification/RESPONSIVE-0.2.59.md); STATUS/README/portal chrome/wizard updated.

## 0.2.58 — 2026-08-30

- Mobile property wizard: thin step track (no large circles), denser fields, auto-focus next field after selects.

## 0.2.57 — 2026-08-30

- Mobile wizard: compact step bar (current page + small numbers) instead of large 7-circle grid; clearer property cards and smaller status chips.

## 0.2.56 — 2026-08-30

- Fix mobile property list vanishing (CSS hid cards after table); denser phone metrics/header and show records as cards.

## 0.2.55 — 2026-08-30

- Hide Nest 401 banner on owner portal when records load from Neon; fix ghost/white logo on mobile header; denser phone layout for chrome, metrics, and ops pages.

## 0.2.54 — 2026-08-30

- Property photos: client-side compression + Vercel→R2→Neon upload (with Nest fallback); gallery served via `/api/owner/media/:id`.
- Mobile portal chrome: single logo, one account avatar; portfolio cards instead of sideways table swipe; Property 360 gallery scaled for phones.

## 0.2.53 — 2026-08-30

- Edit wizard prefills maps/profile/amenities/meters and keeps existing gallery/docs; Neon `PATCH` updates profile, amenities, documents metadata, and meters.
- Property 360 redesigned booking-style (gallery, price summary, map, amenity chips); Neon loader returns profile, coordinates, maps URL, and gallery.

## 0.2.52 — 2026-08-30

- Property wizard (create/edit) uses full content width like Property 360.

## 0.2.51 — 2026-08-30

- Property 360 is full-width / mobile-friendly and **read-only**; editing only via «تعديل العقار» (wizard).

## 0.2.50 — 2026-08-30

- Property **edit** save uses Vercel→Neon `PATCH /api/owner/properties/:id` (no Nest/Render), including address, owner, and units.

## 0.2.49 — 2026-08-30

- Property create: redirect to Property 360 after save; Neon idempotency + block duplicate name+address; choose ownership party in wizard; Edit route reuses wizard.
- Property 360: show serial/property no., owner name, address/location, and QR code that opens the property page.
- Portfolio list columns: property no., owner, location.
- Pin TypeScript to `~5.9.3` (block Dependabot TS 6 breaking `@types/node` builds); add `@types/node` to authz/security.

## 0.2.48 — 2026-08-30

- **Break Nest dependency for property save:** wizard POSTs to `/api/owner/properties` (Vercel → Neon) instead of Render Nest. Photos remain optional; media upload failures no longer wipe a successful save. Nest address `location` uses `ST_GeogFromText`.

## 0.2.47 — 2026-08-30

- Property wizard: images step is **optional** (no longer blocks continue/save). Clearer HEIC/iPhone rejection copy so empty gallery after “choose photos” is explained.

## 0.2.46 — 2026-08-30

- Fix property wizard `Failed to fetch` on media: Express `raw` parser for `/v1/media/ingress` (global `rawBody` stayed off), upload via BFF `/api/backend/v1/media/ingress/...`, clearer Arabic error when the browser reports network failure.

## 0.2.45 — 2026-08-26

- **Root cause:** Nest on Render hung on every controller route because Express `cors` expects `origin(origin, callback)` while `resolveCorsOrigin` was sync-only (callback never called). Fastify previously masked/compounded other listen issues; API now uses **Express** behind a public edge proxy, with callback-style CORS.
- `/raw-ping` (plain Express) worked; `/health/live` and `/v1/*` timed out until CORS was fixed.
- Docs: Arabic handoff [`docs/implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md`](./docs/implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md) (problems, attempted fixes, fallbacks); STATUS + NEST-API-HOSTING updated.

## 0.2.44 — 2026-08-26

- Render: public Node edge still owns `PORT`/`/healthz`, but Nest Fastify **never listens**. All other routes (including `/raw-ping` and `/v1/*`) are dispatched with `fastify.inject()`. TCP listen/proxy left Nest “ready” while HTTP hung (blank `/raw-ping`, property save timeout).

## 0.2.43 — 2026-08-26

- Split public edge vs Nest: Node listens on `PORT` for `/healthz` and proxies other paths to Nest Fastify on `127.0.0.1:(PORT+1)`. Fixes Live `/healthz` while `/raw-ping` and property save hung.

## 0.2.42 — 2026-08-26

- Early-bind raw Node HTTP on `PORT` before Nest (Render port scan + `/healthz`). Attach Fastify via `serverFactory` to the same server without a second `listen`. Avoid Nest `listen` + self-fetch deadlock that left HTTP hung after “listening”.

## 0.2.41 — 2026-08-26

- Remove Fastify `serverFactory` health short-circuit (it broke all non-health routes including `/raw-ping` and `/v1/*`, so property save hung ~160s). Register `/healthz` on Fastify normally; shorten BFF mutation timeout to 25s; point errors at `/healthz`.

## 0.2.40 — 2026-08-26

- Portal Nest “online” uses `/healthz` (works on Live Render). `/api/warm` + cron + reconnect link switched off hanging `/health/ready`. Ops banner treats healthz OK as online even when Nest `/v1` context times out.

## 0.2.39 — 2026-08-26

- Render health: answer `/healthz` and `/health/live` via raw Node `serverFactory` before Nest (Nest Fastify inject/requests were hanging after listen). Set Render Health Check Path to `/healthz`. Keep `PORT=10000`.

## 0.2.38 — 2026-08-26

- Stop forcing port 10000 in code while Render `PORT=4000` (caused explicit scan-for-4000 failure). Listen on `process.env.PORT`; require dashboard `PORT=10000`. Soft inject probe + `@SkipThrottle` on health.

## 0.2.37 — 2026-08-26

- On Render, **always bind port 10000** (ignore dashboard `PORT=4000`) and restore Nest `app.listen`; verify with Fastify `inject(/health/live)` instead of loopback `fetch` (which timed out while the socket looked bound).

## 0.2.36 — 2026-08-26

- Align Nest listen port with Render default **10000** (Dockerfile `EXPOSE`/`PORT`, config default). Bind via Fastify `listen` directly + self-check `/health/live`. Fixes deploys where Node logged `0.0.0.0:4000` but Render still reported no open HTTP ports.

## 0.2.35 — 2026-08-26

- Fix Render “No open HTTP ports detected”: Nest Fastify now binds with `listen(port, '0.0.0.0')` and logs the bound address (previous object-form listen left Render unable to route → 502 / hung deploys).

## 0.2.34 — 2026-08-26

- Render health check uses `/health/live` (avoids Nest marked unhealthy when Neon Free is cold).
- `/health/ready` times out DB probe at 5s instead of hanging forever.

## 0.2.33 — 2026-08-26

- When Nest (Render) is down: owner properties + contacts lists load from Neon on Vercel (read path); ops Nest calls time out in ~3.5s; banner clarifies DB read vs Nest for writes.
- `/api/warm` waits up to ~55s for Render free-tier cold start (was 8s).
- `REDIS_URL` must be `redis://` / `rediss://` (reject Upstash console HTTPS pages).

## 0.2.32 — 2026-08-26

- Portal SPA nav (WAZEN-like): sidebar `prefetch` + idle `PortalRoutePrefetch` for all sections; client `staleTimes` 180s/600s; no loading flash; `scroll={false}`.

## 0.2.31 — 2026-08-26

- Portal speed (WAZEN lessons): dashboard overview reads Neon directly on Vercel when `DATABASE_URL` is set — no Nest wait for `/owner` metrics.
- WAZEN-style `NavigationProgress` top bar; raise client `staleTimes` (60s/300s).
- Docs: `WAZEN-SPEED-LESSONS-AR.md`.

## 0.2.30 — 2026-08-26

- Docs: Cloudflare Workers project `bhd-r` is not the deploy path — Git builds fail by design without wrangler; disconnect Git and use Vercel+Render (`CLOUDFLARE-NOT-DEPLOY-PATH-AR.md`).

## 0.2.29 — 2026-08-26

- Property wizard media: appending photos keeps existing ones (no replace); add-more label, remove per image, max 12.
- Save warm check fails within ~8s (no 25–180s hang); clear success banner on error; Nest reconnect actions on save failure.

## 0.2.28 — 2026-08-26

- Portal flicker: shell auth via JWT (`requirePortalShell`, ≤900ms DB race) so nav/chrome stay mounted; slim route pending bar.
- Nest keep-warm: Vercel cron `/api/cron/warmup-nest` every 5 minutes (`CRON_SECRET`); sidebar `prefetch={false}` to avoid RSC storms when Nest is down.
- Docs: PORTAL-PERF-AR updated for Nest downtime + shell auth.

## 0.2.27 — 2026-08-25

- Property save: fail fast when Nest is down (BFF upstream timeout, Arabic CSRF/Nest errors, warm check before save) instead of hanging ~160s on «Could not establish a secure request».

## 0.2.26 — 2026-08-25

- Portal performance: NestKeepAlive `/api/warm`, drop per-nav health probe, SPA `Link`+prefetch in ops console, CSRF token reuse, parallel media uploads (×3), Next `staleTimes` for soft nav.
- Ops banner: clearer Nest-down copy + «Reconnect to Nest» (`/api/warm` then refresh); NEST-API-HOSTING troubleshooting.
- Docs: `docs/implementation/PORTAL-PERF-AR.md`.

## 0.2.25 — 2026-08-25

- Fix Nest/Render Docker build: CORS origin must be Nest sync resolver (`resolveCorsOrigin`), not Express-style callback — unblocks API deploys stuck since `5766f9a` and restores media-ingress save path.
- Docs: `docs/implementation/RELEASE-0.2.25-AR.md` (publish checklist), NEST-API-HOSTING, PROPERTY-WIZARD, README.

## 0.2.24 — 2026-08-25

- Fix property save `Failed to fetch`: media uploads via Nest ingress token (same-origin `/v1/media/ingress/...`) instead of browser→S3; CSP connect-src allows Nest; clearer Arabic network errors; BFF `maxDuration` 60s; wizard warms API on open.
- Docs: PROPERTY-WIZARD-AR, NEST-API-HOSTING; Render env `PUBLIC_NEST_ORIGIN`.

## 0.2.23 — 2026-08-25

- Mobile portal: fix drawer sidebar stuck open (entrance `transform` animation + `≤1100px` layout cascade overriding the drawer breakpoint).
- Mobile dashboard: stack hero/actions, tighten alerts/metrics/shortcuts/activity for phones; drawer uses `matchMedia` + `inert` when closed.
- Docs: `PORTAL-DASHBOARD-AR.md`, `PORTAL-CHROME-AR.md`.

## 0.2.22 — 2026-08-25

- Portal dashboard: live stats (properties, units, leases, vacant, tickets, expiring, open invoices), clickable alerts, finance pulse, shortcuts, and last-updated timestamp from overview API.
- Operations console chrome elevated to wizard-level glass headers, rainbow metric accents, refined toolbar/search/table actions across shared portal sections.
- Docs: `docs/implementation/PORTAL-DASHBOARD-AR.md`.

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
