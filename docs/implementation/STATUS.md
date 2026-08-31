# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.4.1  
**Active focus:** BHD R Stays — webhook + live inventory locks; flag still off in production  
**Release 0.4.1:** [`RELEASE-0.4.1-AR.md`](./RELEASE-0.4.1-AR.md)  
**Release 0.4.0:** [`RELEASE-0.4.0-AR.md`](./RELEASE-0.4.0-AR.md)  
**Stays verify:** [`../verification/stays-phases-1-8.md`](../verification/stays-phases-1-8.md)  
**Stays pack:** [`../product/daily-stays/README.md`](../product/daily-stays/README.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| stay_booking webhook + live GiST locks | **shipped 0.4.1** | Flags still default off |
| Stays 0–8 foundations | **shipped 0.4.0 (flag off)** | Schema+API+UI shells |
| Marketing session via Next cookie | **shipped 0.3.10** | `/api/auth/me` |
| Browse list/grid/table toggle | **shipped 0.3.9** | Toolbar view switcher |
| Map + discovery + reviews | **shipped 0.3.8** | Pins + reviews + party profiles |

## Next (human / infra)

1. Redeploy Nest (Render) so Finance webhook + `StaysInventoryService` are live.  
2. Pilot: `STAYS_PLATFORM_ENABLED=true` + `STAYS_ORG_ALLOWLIST` for one org only.  
3. ClamAV؛ Nest+DB E2E كامل؛ Neon non-BYPASS؛ تدوير أسرار.  
4. اختياري: أرشفة مشروع Vercel `web` الخاطئ.

## Verification

See `RELEASE-*-AR.md` and `docs/verification/stays-phases-1-8.md`.
