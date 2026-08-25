# SSO verify hotfix — 0.2.6

**Date:** 2026-08-25  
**Symptom:** `?bhd=verify` after returning from `id.bhd-om.com`  
**Production:** `https://bhd-r-api-phi.vercel.app` / `https://r.bhd-om.com`

## Cause

1. Product error UI looked like a second login portal (Identity branding clone).
2. Identity catalog had `bhd-r` as `mode: browse` (fixed on ONE-BHD to `sso`).
3. Token verify after PKCE could fail HS256 and then fail `/oauth/userinfo` when Identity returned `null` fields (Zod rejected null → masked as signature/`BHD_IDENTITY_TOKEN_SECRET` error).
4. Vercel Root Directory `apps/web` risked shipping a stale `@bhd-r/authz` dist from Git while local CLI deploys only uploaded small diffs.

## Fix

| Area | Change |
|------|--------|
| Login UX | `/login` → `/api/auth/bhd/start` unless `?local=1` or `?bhd=` error; compact error page points to Identity |
| OAuth | Seal `redirectUri` in state; cookie `Path=/`; clear both legacy paths on logout |
| Verify | `apps/web/src/lib/bhd/verify-id-token.ts` — userinfo first after PKCE, null-tolerant, HS256 fallback |
| Ops | `scripts/fix-vercel-identity-env.mjs`, `.vercelignore` |
| Identity | `bhd-r` `mode=sso`, `startUrl` → `/api/auth/bhd/start` |

## Accept

1. Private window → https://bhd-r-api-phi.vercel.app/ar/login → lands on `id.bhd-om.com`.
2. After password → returns to portal without `?bhd=verify`.
3. App switcher opens BHD R via SSO start URL.
