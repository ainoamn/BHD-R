# Phase 3 verification — 2026-08-25 (complete)

**Product version:** 0.2.4

## Landed

- Unit + property JSON-LD: `RealEstateListing`, `BreadcrumbList`, `Organization`
- hreflang `ar` / `en` / `x-default` helper
- Portal `noindex` + `robots.ts` disallow for `/portal`
- Public fetch cache tags + `POST /api/revalidate` (secret header)
- Sitemap pagination raised (40×50) for published listings only
- Lighthouse CI mobile on push/PR for `/ar`, `/en`, `/ar/properties`, `/en/properties`

## Residual (accepted)

- Property wizard server draft autosave / optimistic locking — deferred (final create remains transactional + Idempotency-Key)

## Commands

| Command              | Result |
| -------------------- | ------ |
| `pnpm format:check`  | pass   |
| `pnpm verify:source` | pass   |
| `pnpm lint`          | pass   |
| `pnpm typecheck`     | pass   |
| `pnpm test`          | pass   |
| `pnpm build`         | pass   |
| `pnpm test:e2e`      | pass   |

## Ops note

Set `REVALIDATE_SECRET` on the web deployment to enable on-demand `POST /api/revalidate` after availability changes.
