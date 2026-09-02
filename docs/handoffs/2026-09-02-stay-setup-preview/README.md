# Handoff — Stay setup portfolio units + bilingual policies (0.4.34)

**Date:** 2026-09-02  
**Production:** https://r.bhd-om.com

## Changes

- Units table styled like `/owner/properties` ops table (thumb, status pill, select).
- Unit covers loaded per unit (fallback to property cover).
- Real translation buttons for unit type name and dual policy textareas.
- Instructions removed from setup wizard (cleared on save).
- Publish step uses `StayPublicShowcase` in preview mode.

## Key files

- `apps/web/src/components/stays/stay-setup-wizard.tsx`
- `apps/web/src/lib/stay-setup-neon.ts`
- `apps/web/src/components/stays/stay-public-showcase.tsx`
