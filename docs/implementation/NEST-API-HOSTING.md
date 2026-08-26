# Nest API hosting (BHD-R)

**Goal:** Public HTTPS Nest (`apps/api`) so Vercel web can call `/v1/*` via `API_INTERNAL_ORIGIN`.  
**Image:** `Dockerfile.api` (port **4000**, health `/health/ready`).  
**Blueprint:** root `render.yaml` (Render Blueprint).

## Why not the Vercel web project?

Project `bhd-r-api` Root Directory is `apps/web` (Next.js). Nest is a long-lived Node process with Redis/S3/DB pooling — host it as a **separate** Docker service (Render / Fly / VM). Vercel Nest-as-Function is possible later but not the default path for this monorepo.

## Render (recommended starter)

1. Connect GitHub repo `ainoamn/BHD-R` in [Render](https://render.com).
2. Apply Blueprint from `render.yaml` **or** create a Web Service manually:
   - Dockerfile: `Dockerfile.api`
   - Health check: `/health/ready`
   - Port: `4000`
3. Set env vars (Production) — mirror API secrets from `.env.example`:
   - `DATABASE_URL` (Neon, same DB as web if web uses direct DB; else API Neon role)
   - `REDIS_URL`
   - `BHD_IDENTITY_*` / `BHD_OAUTH_*` / `BHD_IDENTITY_TOKEN_SECRET`
   - `BHD_R_SESSION_SECRET`, field encryption keys
   - `S3_*` as needed
   - `WEB_ORIGIN` / `PUBLIC_WEB_ORIGIN` = `https://r.bhd-om.com`
   - Optional `WEB_ORIGINS` = comma list of extra browser origins (staging, etc.)
   - Preview Vercel hosts `bhd-r-api-*.vercel.app` are allowed by default for CSRF/CORS (disable with `WEB_ORIGIN_ALLOW_VERCEL_PREVIEWS=0`)
   - `CORS` / cookie domain settings as documented in identity setup
4. After deploy, note the service URL, e.g. `https://bhd-r-api.onrender.com`.
5. Optional DNS: `api.r.bhd-om.com` → Render.

## Wire Vercel web

```bash
# Production + Preview (PowerShell-safe: use scripts, avoid trailing \r)
vercel env add API_INTERNAL_ORIGIN production
# value: https://api.r.bhd-om.com   (or the Render URL)
vercel env add API_ORIGIN production
# same value if used by rewrites
```

Browser mutations call `/api/backend/v1/*` (Next BFF) which forwards cookies and sets `Origin` to `WEB_ORIGIN` / `PUBLIC_WEB_ORIGIN`, so CSRF accepts both production and Vercel preview hosts without false “Cross-site request rejected”.

### Media uploads (property wizard)

Browsers must **not** PUT directly to private MinIO/S3 URLs (CSP `connect-src` + CORS → `Failed to fetch`). Nest issues a short-lived ingress token:

- `PUT /v1/media/ingress/:token` (`@Public`) accepts the raw file body and writes to S3 server-side.
- Web prefers same-origin `/v1/media/ingress/...` (Next rewrite) with absolute `PUBLIC_NEST_ORIGIN` fallback.
- Set on Render: `PUBLIC_NEST_ORIGIN=https://bhd-r.onrender.com` (Render also exposes `RENDER_EXTERNAL_URL`).
- Web CSP allows Nest origins via `API_INTERNAL_ORIGIN` / `PUBLIC_NEST_ORIGIN` / `https://bhd-r.onrender.com`.

Also ensure `NEXT_PUBLIC_API_ORIGIN=https://r.bhd-om.com` (same-origin browser) remains as today.

Redeploy **web (Vercel)** after this change. Redeploy **Nest (Render)** when pulling CSRF guard updates.

**Arabic click-by-click for Vercel:** [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md).

## عندما تظهر «تعذّر الوصول إلى Nest API»

الرسالة تعني: **Vercel مضبوط** (`API_INTERNAL_ORIGIN`) لكن **Nest على Render لا يرد**.

فحص سريع (من جهازك):

```text
https://bhd-r.onrender.com/health/ready
```

- إن فشل أو بقي يحمّل طويلاً → المشكلة في **Render** وليس في الواجهة.
- من لوحة Render: الخدمة `bhd-r` / `bhd-r-api` → **Logs** (ابحث عن crash / Invalid environment) → **Manual Deploy** لـ `main` (≥ `6e5b607`) → انتظر **Live**.
- بعد Live أعد تحميل `/ar/owner/properties` أو اضغط «إعادة الاتصال بـ Nest».

لا تغيّر `API_INTERNAL_ORIGIN` إلى localhost. القيمة الصحيحة عادة: `https://bhd-r.onrender.com`.

1. `GET https://API_HOST/health/ready` → 200 (if this hangs >30s, Nest is down or sleeping — fix Render first; portal pages will feel like 60–80s)
2. SSO login on `https://r.bhd-om.com`  
3. Owner overview loads metrics (not empty fail-soft)  
4. Confirm reservation deposit → journal appears in accounting  
5. End lease → vacancy task in Tasks  

## Keep Nest warm (Vercel Cron)

Web app pings Nest every 5 minutes via `GET /api/cron/warmup-nest` (`apps/web/vercel.json`).

1. Add Vercel env `CRON_SECRET` (random ≥24 chars) on Production + Preview.
2. Redeploy web after changing `vercel.json` crons.
3. In Vercel → Settings → Cron Jobs, confirm `*/5 * * * *` → `/api/cron/warmup-nest`.
4. If Nest still never answers `/health/ready`, open Render dashboard and **Manual Deploy** / check logs — cron cannot revive a crashed service.

## Required env checklist (Render will fail without these)

After Docker build, Nest boots with `loadEnvironment`. Missing keys abort the process.

| Key | Source |
|-----|--------|
| `DATABASE_URL` | Neon |
| `REDIS_URL` | Upstash or Render Redis |
| `S3_ENDPOINT`, `S3_BUCKET_PRIVATE`, `S3_BUCKET_PUBLIC`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3 / R2 / MinIO |
| `BHD_IDENTITY_CLIENT_ID` | `bhd-r` (or set `BHD_OAUTH_CLIENT_ID` — accepted as alias) |
| `BHD_IDENTITY_CLIENT_SECRET`, `BHD_IDENTITY_ISSUER`, `BHD_IDENTITY_REDIRECT_URI` | Identity / Vercel |
| `BHD_R_SESSION_SECRET`, `CSRF_SECRET`, `FIELD_ENCRYPTION_KEY_V1` | Generate ≥32 chars; keep stable |
| `PAYMENT_WEBHOOK_SECRET` | Generate ≥8 chars (placeholder OK until payments) |
| `PUBLIC_PROPERTY_BASE_URL` | `https://r.bhd-om.com` |

## Security

- Never set `API_INTERNAL_ORIGIN=http://localhost:4000` on Vercel.  
- Rotate Neon password if it was pasted in chat; update Render + Vercel `DATABASE_URL`.  
- Do not commit connection strings.

## Status

| Item | Status |
|------|--------|
| `Dockerfile.api` | Ready |
| `render.yaml` | Ready (scaffold) |
| Public Nest URL | `https://bhd-r.onrender.com` (`/health/ready` → ready) |
| Browser mutations | Via Vercel BFF `/api/backend/v1/*` (sets trusted `Origin`) |
| Vercel `API_INTERNAL_ORIGIN` | Must be Nest HTTPS on Production **and** Preview |
| CSRF / preview | Nest allowlist + BFF; redeploy **both** Vercel and Render after API CSRF changes |
| CORS typing (0.2.25) | Use `resolveCorsOrigin` (Nest sync). Express-style `corsOriginDelegate(origin, cb)` breaks `nest build` / Render Docker |

### Render build failure (2026-08-25)

Deploys after `2deea1b` failed with exit 1 during Docker build because:

```text
pnpm exec turbo run build --filter=@bhd-r/api...  →  TS2322 on origin: corsOriginDelegate
```

Fixed in `6e5b607` / **0.2.25**. Confirm Render shows **Live** for that commit (or newer) before testing property save.

Arabic publish notes: [`RELEASE-0.2.25-AR.md`](./RELEASE-0.2.25-AR.md).
