# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.4.6  
**Active focus:** BHD R Stays — guest trips list + reference lookup/claim; flag still off  
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
| Guest trips list + reference claim | **shipped 0.4.6** | Flag off → 404/401 |
| Guest interactive checkout UI | **shipped 0.4.5** | Detail page |
| Public quote → hold → pay intent | **shipped 0.4.4** | Nest APIs |
| Public search from inventory days + Redis TTL | **shipped 0.4.3** | 404 while flag off |
| Inventory projector + checkout housekeeping | **shipped 0.4.2** | Worker gated by stays flag |
| stay_booking webhook + live GiST locks | **shipped 0.4.1** | Flags still default off |
| Stays 0–8 foundations | **shipped 0.4.0 (flag off)** | Schema+API+UI shells |
| Marketing session via Next cookie | **shipped 0.3.10** | `/api/auth/me` |

## Next (human / infra)

1. Redeploy Nest **and Worker** on Render from `main` (0.4.4–0.4.6 APIs).  
2. Pilot: `STAYS_PLATFORM_ENABLED=true` + allowlist; checkout → lookup → claim → webhook.  
3. ClamAV فعلي؛ Nest+DB E2E كامل؛ Neon non-BYPASS؛ تدوير أسرار.  
4. اختياري: أرشفة مشروع Vercel `web` الخاطئ.

## Product gaps (Expand–Contract)

- Reports Occupancy/ADR/RevPAR for stays.
- Provider-hosted payment redirect for stay intents (webhook confirm already live).
- iCal/OTA after SSRF controls.

## Verification

See `RELEASE-*-AR.md` and `docs/verification/stays-phases-1-8.md`.
