# دليل BHD R التشغيلي والهندسي

هذه الوثائق هي مرجع البناء والتشغيل والأمن لمنصة **BHD R — إدارة العقارات**. القرار المعماري المعتمد هو Modular Monolith داخل Monorepo، مع عزل المؤسسات في PostgreSQL وعمّال خلفية منفصلين للأعمال الثقيلة.

| الوثيقة                                                                                                                          | الغرض                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md](./implementation/HANDOFF-NEST-RENDER-2026-08-26-AR.md) | **تسليم جلسة 2026-08-26:** أعطال Nest/Render، المحاولات، الحل، ومسارات بديلة |
| [implementation/NEST-API-HOSTING.md](./implementation/NEST-API-HOSTING.md)                               | استضافة Nest على Render وربطه بـ Vercel |
| [implementation/STATUS.md](./implementation/STATUS.md)                                                   | حالة التنفيذ الحالية (0.2.65) |
| [ASSETS.md](./ASSETS.md)                                                                                 | أصول الهوية وشعار BrandMark في حالات الفراغ |
| [implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md](./implementation/PORTAL-ADAPTIVE-PROPERTIES-AR.md)     | عرض عقارات المالك المتجاوب (قائمة/جديد/360/تعديل) |
| [verification/RESPONSIVE-0.2.59.md](./verification/RESPONSIVE-0.2.59.md)                                 | تحقق تجاوب صفحات العقارات 0.2.59 |
| [implementation/PROPERTY-IDENTITY-QR-AR.md](./implementation/PROPERTY-IDENTITY-QR-AR.md)                 | هوية العقار + QR على صفحة 360 |
| [V1-COMPLETION-REPORT-AR.md](./V1-COMPLETION-REPORT-AR.md)                                                                       | **تقرير اكتمال V1 وأدلة التحقق والهجرات وحدود التسليم**           |
| [CODEX_WORKSPACE_2026-08-11_AR.md](./CODEX_WORKSPACE_2026-08-11_AR.md)                                                           | جرد مساحة Codex 2026-08-11 واستبدال الحزم القديمة                 |
| [implementation/TRANSACTION-FLOW-MAP.md](./implementation/TRANSACTION-FLOW-MAP.md)                                               | **مرجع دورة المعاملة المعتمدة v1.3** (إيجار/بيع/إلغاء/تجديد) + [HTML](./implementation/TRANSACTION-FLOW-MAP.html) + [اعتماد](./implementation/CYCLE-APPROVAL.md) |
| [implementation/GAP-REGISTER.md](./implementation/GAP-REGISTER.md)                                                               | سجل فجوات البناء المؤسسي مقابل الكود الحقيقي                      |
| [verification/phase-0.md](./verification/phase-0.md)                                                                             | أدلة بوابة المرحلة 0                                              |
| [legacy-reviews/BHD-OM-operational-workflows-deep-review-ar.md](./legacy-reviews/BHD-OM-operational-workflows-deep-review-ar.md) | التقرير التشغيلي المفصل لـ BHD-OM                                 |
| [PROJECT_DOCUMENTATION_AR.md](./PROJECT_DOCUMENTATION_AR.md)                                                                     | **التوثيق المفصل الشامل للمنتج والتشغيل**                         |
| [SECURITY_CHECKLIST_MATRIX_AR.md](./SECURITY_CHECKLIST_MATRIX_AR.md)                                                             | مصفوفة بنود الأمن المطلوبة مقابل التنفيذ                          |
| [VERCEL_DEPLOYMENT_AR.md](./VERCEL_DEPLOYMENT_AR.md)                                                                             | تمهيد الربط على Vercel                                            |
| [legacy-reviews/README.md](./legacy-reviews/README.md)                                                                           | تقارير مراجعة BHD-OM المرفقة                                      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                                                                             | البنية، حدود الوحدات وتدفق البيانات                               |
| [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)                                                                                   | تشغيل بيئة التطوير من الصفر                                       |
| [API_OVERVIEW.md](./API_OVERVIEW.md)                                                                                             | قواعد API، الأخطاء، idempotency وwebhooks                         |
| [OMANI_UI_2026-08-23.md](./OMANI_UI_2026-08-23.md)                                                                               | إعادة التصميم العُماني والدخول الموحّد                            |
| [OPERATIONS_SUITE_AR.md](./OPERATIONS_SUITE_AR.md)                                                                               | **الحزمة التشغيلية المتكاملة** (عقارات، عقود، محاسبة، تقارير…)    |
| [RELEASE_SYNC_0.1.6.md](./RELEASE_SYNC_0.1.6.md)                                                                                 | تحقق مزامنة حزمة complete 0.1.6                                   |
| [PARENT_FOLDER_SYNC_AR.md](./PARENT_FOLDER_SYNC_AR.md)                                                                           | خريطة مجلد العمل الأب → مسارات المستودع                           |
| [screenshots/2026-08-23/](./screenshots/2026-08-23/)                                                                             | لقطات لوحات النظام ومعالج العقار                                  |
| [BHD-R-IDENTITY-SETUP.md](./BHD-R-IDENTITY-SETUP.md)                                                                             | ربط هوية BHD وVercel لنطاق النشر الحالي                           |
| [SSO.md](./SSO.md)                                                                                                               | الدخول الموحد وربط هوية BHD                                       |
| [COUNTRY_PACKS.md](./COUNTRY_PACKS.md)                                                                                           | الدول والعملات والترجمة                                           |
| [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md)                                                                                   | ضوابط الأمن وطريقة إثباتها                                        |
| [THREAT_MODEL.md](./THREAT_MODEL.md)                                                                                             | نموذج التهديد وحدود الثقة                                         |
| [PRIVACY_AND_RETENTION.md](./PRIVACY_AND_RETENTION.md)                                                                           | الخصوصية، الاحتفاظ والحذف                                         |
| [PERFORMANCE.md](./PERFORMANCE.md)                                                                                               | ميزانيات الأداء والتوسّع                                          |
| [TESTING.md](./TESTING.md)                                                                                                       | استراتيجية الاختبارات وبوابات الدمج                               |
| [VERIFICATION.md](./VERIFICATION.md)                                                                                             | نتيجة التحقق النهائية وحدود ما يحتاج صلاحيات الإنتاج              |
| [DEPLOYMENT.md](./DEPLOYMENT.md)                                                                                                 | طوبولوجيا النشر وقائمة الجاهزية                                   |
| [RELEASES_AND_MIGRATIONS.md](./RELEASES_AND_MIGRATIONS.md)                                                                       | الإصدارات والهجرات والرجوع                                        |
| [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)                                                                                         | النسخ الاحتياطي واختبار الاستعادة                                 |
| [RUNBOOKS.md](./RUNBOOKS.md)                                                                                                     | الاستجابة للأعطال والحوادث الأمنية                                |
| [LEGACY_MIGRATION.md](./LEGACY_MIGRATION.md)                                                                                     | نقل البيانات من النظام السابق                                     |
| [WORKER_OPERATIONS.md](./WORKER_OPERATIONS.md)                                                                                   | الطوابير، الصور، PDF والإشعارات                                   |
| [PRODUCT_AND_DECISIONS.md](./PRODUCT_AND_DECISIONS.md)                                                                           | ملخص المرحلة صفر وقرارات المنتج/ADRs                              |
| [ASSETS.md](./ASSETS.md)                                                                                                         | أصول الهوية المولّدة ومصدرها وتعليمات إعادة إنتاجها               |
| [الخطة الهندسية العربية](./product/BHD-R-BUILD-PLAN-AR.md)                                                                       | الخطة المعتمدة الكاملة ومراحل البناء                              |
| [حزمة المرحلة صفر](./phase-0/00-README.md)                                                                                       | تعريف المنتج، الرحلات، الصلاحيات، المجال، التهديدات وADRs الأصلية |

الوثائق تصف هدفاً إنتاجياً، لكن لا تعني أن البنية التحتية الخارجية أو مفاتيح الدفع دُوّرت. تلك الإجراءات تُنفذ فقط بصلاحيات بيئة الإنتاج وسجل تغيير معتمد.
