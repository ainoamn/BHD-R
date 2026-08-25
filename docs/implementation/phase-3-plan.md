# Phase 3 plan — portfolio, media, public SEO

## Requirements (build command §8)

Close residuals on public SEO, cache tags, portal noindex, and Lighthouse mobile CI. Core portfolio/media already landed in earlier releases.

## Implementation

1. JSON-LD `@graph`: `RealEstateListing` + `BreadcrumbList` + `Organization` on unit and property pages.
2. hreflang `ar` / `en` / `x-default` via `bilingualAlternates`.
3. Portal layouts + `/portal` emit `robots: noindex`; `robots.ts` disallows portal paths.
4. `publicApiFetch` cache tags (`public-listings`, `unit:*`, `property:*`) + `POST /api/revalidate`.
5. Sitemap cursor pages raised to 40×50; still filtered to published/available listings only.
6. Lighthouse CI: mobile preset, properties routes, runs on `push`/`pull_request` to `main`.

## Deferred (documented residual)

- Server draft autosave + optimistic locking for the property wizard (larger UX change; final submit remains transactional + Idempotency-Key).
- Full axe keyboard matrix and load-test p95 budgets (Phase 10 overlap).

## Acceptance

- SEO structured data present on listing pages.
- Private portals not indexable.
- Performance workflow configured for mobile public routes.
- Verification gate green; `docs/verification/phase-3.md` recorded.
