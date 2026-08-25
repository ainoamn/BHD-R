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

Also ensure `NEXT_PUBLIC_API_ORIGIN=https://r.bhd-om.com` (same-origin browser) remains as today.

Redeploy web after env change.

**Arabic click-by-click for Vercel:** [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md).

## Smoke checklist

1. `GET https://API_HOST/health/ready` → 200  
2. SSO login on `https://r.bhd-om.com`  
3. Owner overview loads metrics (not empty fail-soft)  
4. Confirm reservation deposit → journal appears in accounting  
5. End lease → vacancy task in Tasks  

## Security

- Never set `API_INTERNAL_ORIGIN=http://localhost:4000` on Vercel.  
- Rotate Neon password if it was pasted in chat; update Render + Vercel `DATABASE_URL`.  
- Do not commit connection strings.

## Status

| Item | Status |
|------|--------|
| `Dockerfile.api` | Ready |
| `render.yaml` | Ready (scaffold) |
| Public Nest URL | Pending (needs Render/Fly account + secrets) |
| Vercel `API_INTERNAL_ORIGIN` | Pending until URL exists |
