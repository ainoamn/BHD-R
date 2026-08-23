# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first production release.

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
