# Handoff — Hisaby sync 0.4.79 (published)

**Date:** 2026-09-09  
**BHD-R:** `1478983` · feature `a8caf1b`  
**Hisaby:** `6c410e4` · https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md

## Live behavior (after one-time key paste)

| Direction | Mechanism |
| --- | --- |
| R → Hisaby | Worker push to `POST https://hisaby.bhd-om.com/api/integrations/bhd-r/events` |
| Hisaby → R | Pull every 15 min (+ immediate on save) via `GET /v1/integrations/hisaby/export` then list APIs |

Hisaby flattens worker payloads and returns HTTP 200 `skipped` for informational topics (journals/cheques) so auto-push does not fail.

## Prod checklist

1. Hisaby: `prisma migrate deploy`
2. BHD-R: `pnpm --filter @bhd-r/db migrate` (applies `custom/0024_hisaby_links.sql`)
3. Owner links inbound token + read key once (`/bhd-r` + `/ar/owner/api-keys`)
4. Optional: connection test + manual `POST /api/integrations/bhd-r/sync` on Hisaby
