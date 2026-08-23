# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first production release.

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
