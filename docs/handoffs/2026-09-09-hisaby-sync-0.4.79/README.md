# Handoff — Hisaby sync foundation 0.4.79

**Date:** 2026-09-09  
**Version:** 0.4.79

## Shipped in BHD-R

| Piece | Path / endpoint |
| --- | --- |
| Full Hisaby read scopes UI | `operations-console.tsx` (`HISABY_READ_SCOPES`) |
| Connection form | `/ar/owner/api-keys` |
| Export snapshot | `GET /v1/integrations/hisaby/export` |
| Connection CRUD/test | `PUT/GET /v1/integrations/hisaby/connection`, `POST .../test` |
| Schema + migration | `hisaby_links` · `packages/db/migrations/custom/0024_hisaby_links.sql` |
| Worker push | `apps/worker/src/hisaby-push.ts` on finance/stay payment topics |

## Not live until Hisaby

Hisaby must expose inbound token + `POST` events endpoint on `hisaby.bhd-om.com` (see `HISABY-API-KEYS-AR.md` agent command).

## Deploy notes

- Run custom migration `0024_hisaby_links.sql` (or first Nest `ensureHisabyLinksTable` creates table).
- Grant worker SELECT/UPDATE on `hisaby_links` if not already (privileged script updated).
- Redeploy Nest API + worker + web.
