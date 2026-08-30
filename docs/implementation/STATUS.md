# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.68  
**Active focus:** Public unit page = Property 360 showcase  
**Handoff:** [`HANDOFF-NEST-RENDER-2026-08-26-AR.md`](./HANDOFF-NEST-RENDER-2026-08-26-AR.md)  
**Property identity/QR:** [`PROPERTY-IDENTITY-QR-AR.md`](./PROPERTY-IDENTITY-QR-AR.md)  
**Adaptive properties UI:** [`PORTAL-ADAPTIVE-PROPERTIES-AR.md`](./PORTAL-ADAPTIVE-PROPERTIES-AR.md)  
**Brand assets:** [`../ASSETS.md`](../ASSETS.md)  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.3** · [`CYCLE-APPROVAL.md`](./CYCLE-APPROVAL.md)  
**Portal UI:** [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md)  
**Property wizard:** [`PROPERTY-WIZARD-AR.md`](./PROPERTY-WIZARD-AR.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0–4 | complete | Verified |
| OM ops 1–19 | coded | Nest على `https://bhd-r.onrender.com` |
| Cycle R1–R5 | **approved + coded** | Queues, finance_manager gates, ownership history UI |
| Portal chrome | **shipped** | Header user + AR/EN + responsive drawer for all portals |
| Property wizard | **shipped 0.2.49+** | Neon create/edit, ownership choice, redirect, QR |
| Adaptive property surfaces | **shipped 0.2.59** | `portal-adaptive.css` — phone/tablet/desktop scale |
| Public catalogue publish | **shipped 0.2.64** | Neon sync `listings` + heal on Property 360 |
| BrandMark placeholders | **shipped 0.2.65** | Official BHD logo replaces circular “R” |
| Public photos + unit page | **shipped 0.2.66** | Relative media URLs, Neon unit fallback, logo watermark |
| Portfolio view + manage | **shipped 0.2.67** | عرض العقار / إدارة العقار + ops shortcuts on Property 360 |
| Unit public = Property 360 | **shipped 0.2.68** | `/units/:id` same showcase as owner preview |
| Nest Render reachability | **fixed 0.2.45** | Express + edge `/healthz` + CORS callback |

## Next (human / infra)

1. Confirm Vercel **Production Branch = `main`**.  
2. Smoke: https://r.bhd-om.com/ar/properties shows cover photo + watermark; open a unit page without server error.  
3. (Optional) Redeploy Nest on Render so inline media URLs work when Nest is the source.  
4. S3/R2 على Vercel/Render لرفع الصور (`S3_*` env).  
5. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/ASSETS.md`
- `docs/implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md`
- `docs/verification/RESPONSIVE-0.2.59.md`
- `docs/implementation/PROPERTY-IDENTITY-QR-AR.md`
- `docs/implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md`
- `docs/implementation/NEST-API-HOSTING.md`
