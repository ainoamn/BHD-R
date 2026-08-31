# الإصدار 0.4.16 — إصلاح بناء Nest على Render

**التاريخ:** 2026-08-31  
**السطح:** `Dockerfile.api` / خدمة `bhd-r.onrender.com`

## الظاهرة

```
Deploy failed for fb0a74d … Exited with status 1 while building your code
```

Nest القديم بقي Live من صورة سابقة بينما Auto-Deploy للصورة الجديدة فشل.

## السبب

في 0.4.15 ضُبط `apps/web.engines.node` على **`22.x`**. صورة Render تستخدم **Node 24**، و`.npmrc` فيه `engine-strict=true` → `pnpm install --frozen-lockfile` يخرج فوراً أثناء بناء Docker.

## الإصلاح

- `apps/web` engines → `>=22.0.0`
- `Dockerfile.api`: `engine-strict=false` و`minimum-release-age=0` أثناء التثبيت

## تحقق

- Render Events لخدمة Nest يظهر **Live** على commit 0.4.16+
- `GET https://bhd-r.onrender.com/healthz` → `nestReady: true`
