# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.4.4  
**Active focus:** BHD R Stays — public quote → hold → payment intent; flag still off  
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
| Public quote → hold → pay intent | **shipped 0.4.4** | 404 while flag off; webhook confirms |
| Public search from inventory days + Redis TTL | **shipped 0.4.3** | 404 while flag off |
| Inventory projector + checkout housekeeping | **shipped 0.4.2** | Worker gated by stays flag |
| stay_booking webhook + live GiST locks | **shipped 0.4.1** | Flags still default off |
| Stays 0–8 foundations | **shipped 0.4.0 (flag off)** | Schema+API+UI shells |
| Marketing session via Next cookie | **shipped 0.3.10** | `/api/auth/me` |

## Next (human / infra)

1. Redeploy Nest **and Worker** on Render from `main` (0.4.4 booking APIs + prior projector/search).  
2. Pilot: `STAYS_PLATFORM_ENABLED=true` + `STAYS_ORG_ALLOWLIST` for one org; publish one stay listing; run quote→hold→pay with sandbox webhook.  
3. ClamAV فعلي؛ Nest+DB E2E كامل؛ Neon non-BYPASS؛ تدوير أسرار.  
4. اختياري: أرشفة مشروع Vercel `web` الخاطئ.

## Product gaps (Expand–Contract)

- Guest interactive checkout UI (API path live in 0.4.4).
- Reports Occupancy/ADR/RevPAR for stays.
- iCal/OTA after SSRF controls.

## Verification

See `RELEASE-*-AR.md` and `docs/verification/stays-phases-1-8.md`.
