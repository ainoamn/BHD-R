# Environment manifest (Nest API / Render)

Source of truth: `packages/config/src/index.ts` (`environmentSchema` + `loadEnvironment`).  
Blueprint: root `render.yaml` (keys as `sync: false` unless noted).

| Key | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on Render |
| `PORT` | yes | `10000` |
| `DATABASE_URL` | yes | Neon / Postgres |
| `REDIS_URL` | yes | `redis://` or `rediss://` only |
| `WEB_ORIGIN` | yes | `https://r.bhd-om.com` |
| `API_ORIGIN` | optional* | defaults in schema; set to Nest public URL |
| `PUBLIC_PROPERTY_BASE_URL` | yes | usually same as web origin |
| `PUBLIC_WEB_ORIGIN` | recommended | mirrors web |
| `S3_ENDPOINT` | yes | object storage |
| `S3_REGION` | yes | default `us-east-1` / `auto` |
| `S3_BUCKET_PRIVATE` | yes | |
| `S3_BUCKET_PUBLIC` | yes | |
| `S3_ACCESS_KEY` | yes | |
| `S3_SECRET_KEY` | yes | |
| `BHD_IDENTITY_ISSUER` | yes | |
| `BHD_IDENTITY_CLIENT_ID` / `BHD_OAUTH_CLIENT_ID` | yes | aliases |
| `BHD_IDENTITY_CLIENT_SECRET` / `BHD_OAUTH_CLIENT_SECRET` | yes | |
| `BHD_IDENTITY_REDIRECT_URI` / `BHD_OAUTH_REDIRECT_URI` | yes | |
| `BHD_IDENTITY_TOKEN_SECRET` | recommended | HS256 / identity verify |
| `BHD_R_SESSION_SECRET` | yes | ≥32 chars |
| `CSRF_SECRET` | yes | ≥32 chars |
| `PAYMENT_WEBHOOK_SECRET` | yes | HMAC for `POST /v1/webhooks/payments/:provider`. Payload kinds: invoice (default), `reservation_deposit` + `checkoutSessionReference`, or `stay_booking` + `paymentIntentId`. Simulators: `scripts/simulate-reservation-deposit-webhook.mjs`, `scripts/simulate-stay-booking-webhook.mjs` |
| `FIELD_ENCRYPTION_KEY_V1` | yes | |
| `FIELD_ENCRYPTION_ACTIVE_VERSION` | yes | `v1` |
| `PUBLIC_NEST_ORIGIN` | recommended | media ingress / CSP |
| `MEDIA_UPLOAD_BASE_URL` | optional | |
| `TRUST_PROXY_HOPS` | recommended | `1` on Render |
| `STAYS_PLATFORM_ENABLED` | optional | Default **off** (`false`). Platform kill-switch for BHD R Stays. |
| `STAYS_ORG_ALLOWLIST` | optional | Comma-separated org UUIDs (or `*`) when platform flag is on. Property/unit still require explicit enablement in later phases. |

\* `API_ORIGIN` is in the Zod schema with a localhost default — set it in production to the public Nest URL.

## Health

| Path | Meaning |
| --- | --- |
| `GET /healthz` | Edge liveness (process + Nest proxy). Render `healthCheckPath`. |
| `GET /health/live` | Nest process OK |
| `GET /health/ready` | Nest + database `select 1` |

## Web (Vercel) extras

| Key | Notes |
| --- | --- |
| `CRON_SECRET` | ≥16; required for `/api/cron/warmup-nest` and `/api/cron/expire-locks` (fail-closed). Helper: `node scripts/ensure-vercel-cron-secret.mjs` |
| `MEDIA_PUBLIC_PROMOTE_MODE` | `magic_bytes_best_effort` (default) \| `await_worker` |
| `MEDIA_SCAN_MODE` (worker) | `required` \| `best-effort` \| `disabled` — use `best-effort` until ClamAV is live |
| `ALLOW_BOOKING_SANDBOX` | must stay unset/false in production |
| `DATABASE_URL` | Neon (owner writes / catalogue) |
| `API_INTERNAL_ORIGIN` | Nest HTTPS URL for BFF (required on Vercel; no Host fallback) |

## Ops (local / CI — never commit secrets)

| Key | Notes |
| --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | Render Dashboard → service → Deploy Hook. Run `node scripts/trigger-render-deploy.mjs` then `node scripts/verify-nest-health.mjs` |
