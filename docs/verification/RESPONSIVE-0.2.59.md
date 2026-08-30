# Responsive verification — owner property surfaces (0.2.59)

**Date:** 2026-08-30  
**Version:** 0.2.59  
**Commit:** `2ebf071` (+ docs follow-up)  
**Live:** https://bhd-r-api-phi.vercel.app  
**Spec:** [`../implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md`](../implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md)

## Surfaces

| Route | Phone (≤960) | Desktop (≥961) |
| ----- | ------------ | -------------- |
| `/ar/owner/properties` | Cards + 2×2 metrics; no table swipe | Full ops table |
| `/ar/owner/properties/new` | Compact step track + dense fields | Full 7-step rail |
| `/ar/owner/properties/:id` | Summary on top; stacked sections | Sticky summary column |
| `/ar/owner/properties/:id/edit` | Same as new (compact wizard) | Same as new (full rail) |

## Chrome

| Control | Phone | Desktop |
| ------- | ----- | ------- |
| Titles / user card | Hidden | Shown |
| Apps grid | Hidden | Shown |
| Lang + account avatar | Shown (scaled) | Shown |

## Manual checklist (after Vercel Ready)

- [ ] Hard refresh on phone (or clear cache)
- [ ] Portfolio shows property cards matching result count
- [ ] Wizard steps are a thin track (not large circles)
- [ ] Property 360 summary appears above gallery on phone
- [ ] Desktop still shows table + full wizard steps + sticky summary

## Residual

Nest session banners may still appear for Nest-only routes; portfolio/detail Neon paths should not block layout. Wide non-property ops tables may still scroll horizontally by design.
