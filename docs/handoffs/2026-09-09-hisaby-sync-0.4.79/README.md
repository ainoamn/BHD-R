# Handoff — Hisaby sync 0.4.79 (bidirectional)

**Date:** 2026-09-09  
**BHD-R:** `a8caf1b` (feature) · follow-up docs + migrate wire  
**Hisaby:** `6cab208` · https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md

## Live behavior (after one-time key paste)

| Direction | Mechanism |
| --- | --- |
| R → Hisaby | Worker push to `POST /api/integrations/bhd-r/events` |
| Hisaby → R | Pull every 15 min (+ immediate on save) via BHD-R API key |

## Prod checklist

1. Hisaby: `prisma migrate deploy`
2. BHD-R: `pnpm --filter @bhd-r/db migrate` (applies `custom/0024_hisaby_links.sql`)
3. Owner links inbound token + read key once (`/bhd-r` + `/ar/owner/api-keys`)
4. Optional: connection test + manual `POST /api/integrations/bhd-r/sync` on Hisaby

## Notes

- Local Prisma generate on Hisaby may need `--schema=backend/src/prisma/schema.prisma` and project Prisma version — does not block deploy.
- Nest `ensureHisabyLinksTable` can create the table if migrate lagged; worker GRANT still prefers 0024 / privileged roles.
