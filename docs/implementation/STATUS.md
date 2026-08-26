# Implementation status

**Updated:** 2026-08-26  
**Product version:** 0.2.45  
**Active focus:** Nest API على Render مستقر بعد إصلاح CORS/Express — متابعة حفظ العقار والوسائط من الجهاز التالي  
**Handoff (هذه الجلسة):** [`HANDOFF-NEST-RENDER-2026-08-26-AR.md`](./HANDOFF-NEST-RENDER-2026-08-26-AR.md)  
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
| Property wizard | **shipped** | Gated steps, Oman cascade, cover, AI copy, serials |
| Nest Render reachability | **fixed 0.2.45** | Express + edge `/healthz` + CORS callback; كان يعلق `/v1` رغم Live |

## Next (human / infra)

1. Smoke حفظ عقار من https://bhd-r-api-phi.vercel.app/ar/owner/properties/new بعد التأكد من `/health/live`.  
2. تحقق رفع الوسائط (قد يحتاج raw body محدود بعد تعطيل `rawBody` على Nest).  
3. `pnpm db:migrate` إن لم تُطبَّق هجرات `0011` / `0012` على Neon الإنتاج.  
4. (موصى) Render غير Free لتقليل النوم 50s+.  
5. تدوير أسرار ظهرت في محادثات سابقة قبل الإنتاج النهائي.

## Verification

- `docs/implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md` — سجل الأعطال والمسارات البديلة
- `docs/verification/om-ops-flow.md`
- `docs/implementation/NEST-API-HOSTING.md`
- `curl` إلى `/healthz` + `/raw-ping` + `/health/live` (انظر Handoff §1)
