# Phase 4 verification — 2026-08-25

**Product version:** 0.2.5

## Landed

- Responsive: portal/header drawer at ≤960px, ops metrics/panels/forms usable on phone/tablet, safe-area padding, overflow e2e (mobile + tablet project)
- `leads`, `rental_applications`, `cheques` (+ RLS list)
- Unique active hold/reservation per unit
- Reservation legal snapshot (`rent_minor`, `currency`, `terms_snapshot`)
- Cheque APIs + review FSM
- Domain viewing/lead/cheque machines + 50-contender concurrency model test

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

Migrate through **`0010`**, then re-apply RLS. Cheque review requires `cheque.review` (finance/admin roles).
