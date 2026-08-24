# تحقق بناء 0.2.2 (قبل المرحلة 2)

**Commit:** `1316cd6` — Phase 1 encryption backfill + domain FSMs  
**GitHub:** https://github.com/ainoamn/BHD-R/commit/1316cd6  
**إنتاج الويب:** https://bhd-r-api-phi.vercel.app

## أوامر التحقق المحلية (من جذر `BHD-R`)

```bash
git fetch origin && git checkout main && git pull --ff-only
git rev-parse --short HEAD   # يجب أن يظهر 1316cd6 أو أحدث بعده

pnpm format:check
pnpm verify:source
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## ما يجب أن تراه في 0.2.2

| الدليل             | المسار                                                    |
| ------------------ | --------------------------------------------------------- |
| بوابة المرحلة 0    | `docs/verification/phase-0.md`                            |
| بوابة المرحلة 1    | `docs/verification/phase-1.md`                            |
| سجل الفجوات        | `docs/implementation/GAP-REGISTER.md`                     |
| حالة المراحل       | `docs/implementation/STATUS.md`                           |
| هجرة TOTP recovery | `packages/db/migrations/generated/0008_totp_recovery.sql` |
| Backfill التشفير   | `apps/worker/src/encryption/backfill.ts`                  |
| API enqueue        | `POST /v1/platform/encryption/backfill`                   |
| آلات الحالات       | `packages/domain/src/state-machines.ts`                   |

## قاعدة البيانات قبل اعتماد الإنتاج

1. نسخة احتياطية.
2. `pnpm db:migrate` حتى يشمل `0008`.
3. إعادة تطبيق RLS/أدوار التشغيل.
4. ضبط `FIELD_ENCRYPTION_*` على Worker وAPI.

بعد نجاح التحقق أعلاه تُعتبر المرحلة 1 مغلقة ويُسمح ببدء المرحلة 2 (الأطراف/الحدود/الدعوات).
