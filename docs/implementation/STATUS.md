# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.4.18  
**Active focus:** Property photo storage (Nest Bearer + Neon inline fallback)  
**Release 0.4.17:** [`RELEASE-0.4.17-AR.md`](./RELEASE-0.4.17-AR.md)  
**Release 0.4.16:** [`RELEASE-0.4.16-AR.md`](./RELEASE-0.4.16-AR.md)  
**Release 0.4.15:** [`RELEASE-0.4.15-AR.md`](./RELEASE-0.4.15-AR.md)  
**Release 0.4.14:** [`RELEASE-0.4.14-AR.md`](./RELEASE-0.4.14-AR.md)  
**Release 0.4.13:** [`RELEASE-0.4.13-AR.md`](./RELEASE-0.4.13-AR.md)  
**Known issues (portfolio):** [`KNOWN-ISSUES-PROPERTY-PORTFOLIO-AR.md`](./KNOWN-ISSUES-PROPERTY-PORTFOLIO-AR.md)  
**Release 0.4.12:** portfolio CSRF + archive list + permanent delete  
**Release 0.4.11:** [`RELEASE-0.4.11-AR.md`](./RELEASE-0.4.11-AR.md)  
**Release 0.4.10:** [`RELEASE-0.4.10-AR.md`](./RELEASE-0.4.10-AR.md)  
**Release 0.4.9:** [`RELEASE-0.4.9-AR.md`](./RELEASE-0.4.9-AR.md)  
**Release 0.4.8:** [`RELEASE-0.4.8-AR.md`](./RELEASE-0.4.8-AR.md)  
**Release 0.4.7:** [`RELEASE-0.4.7-AR.md`](./RELEASE-0.4.7-AR.md)  
**Release 0.4.6:** [`RELEASE-0.4.6-AR.md`](./RELEASE-0.4.6-AR.md)  
**Release 0.4.5:** [`RELEASE-0.4.5-AR.md`](./RELEASE-0.4.5-AR.md)  
**Release 0.4.4:** [`RELEASE-0.4.4-AR.md`](./RELEASE-0.4.4-AR.md)  
**Release 0.4.3:** [`RELEASE-0.4.3-AR.md`](./RELEASE-0.4.3-AR.md)  
**Release 0.4.2:** [`RELEASE-0.4.2-AR.md`](./RELEASE-0.4.2-AR.md)  
**Release 0.4.1:** [`RELEASE-0.4.1-AR.md`](./RELEASE-0.4.1-AR.md)  
**Stays verify:** [`../verification/stays-phases-1-8.md`](../verification/stays-phases-1-8.md)  
**Stays pack:** [`../product/daily-stays/README.md`](../product/daily-stays/README.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Stay iCal export (read-only) | **shipped 0.4.11** | No outbound fetch; import still blocked |
| Ops cancel / no-show | **shipped 0.4.10** | Release lock + UI actions |
| Ops stay bookings list | **shipped 0.4.9** | Real org-scoped list/detail |
| Stay payment provider redirect | **shipped 0.4.8** | Sandbox session + confirm |
| Occupancy / ADR / RevPAR reports | **shipped 0.4.7** | Ops + owner/dev dashboard |
| Guest trips list + reference claim | **shipped 0.4.6** | Flag off → 404/401 |
| Guest interactive checkout UI | **shipped 0.4.5** | Detail page |
| Public quote → hold → pay intent | **shipped 0.4.4** | Nest APIs |
| Public search from inventory days + Redis TTL | **shipped 0.4.3** | 404 while flag off |
| Inventory projector + checkout housekeeping | **shipped 0.4.2** | Worker gated by stays flag |
| stay_booking webhook + live GiST locks | **shipped 0.4.1** | Flags still default off |
| Stays 0–8 foundations | **shipped 0.4.0 (flag off)** | Schema+API+UI shells |
| Marketing session via Next cookie | **shipped 0.3.10** | `/api/auth/me` |

## Next (human / infra)

1. Redeploy Nest **and Worker** on Render from `main` (through 0.4.11).  
2. Pilot: flag + allowlist; verify `.ics` download from calendar page.  
3. ClamAV فعلي؛ Nest+DB E2E كامل؛ Neon non-BYPASS؛ تدوير أسرار.  
4. اختياري: أرشفة مشروع Vercel `web` الخاطئ.

## Product gaps (Expand–Contract)

- iCal/OTA **import** after SSRF controls (export shipped 0.4.11).
- Non-sandbox live PSP adapter for stay intents.

## Verification

See `RELEASE-*-AR.md` and `docs/verification/stays-phases-1-8.md`.
