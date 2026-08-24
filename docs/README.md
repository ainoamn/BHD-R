# دليل BHD R التشغيلي والهندسي

هذه الوثائق هي مرجع البناء والتشغيل والأمن لمنصة **BHD R — إدارة العقارات**. القرار المعماري المعتمد هو Modular Monolith داخل Monorepo، مع عزل المؤسسات في PostgreSQL وعمّال خلفية منفصلين للأعمال الثقيلة.

| الوثيقة                                                              | الغرض                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [PROJECT_DOCUMENTATION_AR.md](./PROJECT_DOCUMENTATION_AR.md)         | **التوثيق المفصل الشامل للمنتج والتشغيل**                         |
| [SECURITY_CHECKLIST_MATRIX_AR.md](./SECURITY_CHECKLIST_MATRIX_AR.md) | مصفوفة بنود الأمن المطلوبة مقابل التنفيذ                          |
| [VERCEL_DEPLOYMENT_AR.md](./VERCEL_DEPLOYMENT_AR.md)                 | تمهيد الربط على Vercel                                            |
| [legacy-reviews/README.md](./legacy-reviews/README.md)               | تقارير مراجعة BHD-OM المرفقة                                      |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                 | البنية، حدود الوحدات وتدفق البيانات                               |
| [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)                       | تشغيل بيئة التطوير من الصفر                                       |
| [API_OVERVIEW.md](./API_OVERVIEW.md)                                 | قواعد API، الأخطاء، idempotency وwebhooks                         |
| [OMANI_UI_2026-08-23.md](./OMANI_UI_2026-08-23.md)                   | إعادة التصميم العُماني والدخول الموحّد                            |
| [OPERATIONS_SUITE_AR.md](./OPERATIONS_SUITE_AR.md)                   | **الحزمة التشغيلية المتكاملة** (عقارات، عقود، محاسبة، تقارير…) |
| [RELEASE_SYNC_0.1.6.md](./RELEASE_SYNC_0.1.6.md)                     | تحقق مزامنة حزمة complete 0.1.6                               |
| [PARENT_FOLDER_SYNC_AR.md](./PARENT_FOLDER_SYNC_AR.md)               | خريطة مجلد العمل الأب → مسارات المستودع                       |
| [screenshots/2026-08-23/](./screenshots/2026-08-23/)                 | لقطات لوحات النظام ومعالج العقار                              |
| [BHD-R-IDENTITY-SETUP.md](./BHD-R-IDENTITY-SETUP.md)                 | ربط هوية BHD وVercel لنطاق النشر الحالي                       |
| [SSO.md](./SSO.md)                                                   | الدخول الموحد وربط هوية BHD                                       |
| [COUNTRY_PACKS.md](./COUNTRY_PACKS.md)                               | الدول والعملات والترجمة                                           |
| [SECURITY_CONTROLS.md](./SECURITY_CONTROLS.md)                       | ضوابط الأمن وطريقة إثباتها                                        |
| [THREAT_MODEL.md](./THREAT_MODEL.md)                                 | نموذج التهديد وحدود الثقة                                         |
| [PRIVACY_AND_RETENTION.md](./PRIVACY_AND_RETENTION.md)               | الخصوصية، الاحتفاظ والحذف                                         |
| [PERFORMANCE.md](./PERFORMANCE.md)                                   | ميزانيات الأداء والتوسّع                                          |
| [TESTING.md](./TESTING.md)                                           | استراتيجية الاختبارات وبوابات الدمج                               |
| [VERIFICATION.md](./VERIFICATION.md)                                 | نتيجة التحقق النهائية وحدود ما يحتاج صلاحيات الإنتاج              |
| [DEPLOYMENT.md](./DEPLOYMENT.md)                                     | طوبولوجيا النشر وقائمة الجاهزية                                   |
| [RELEASES_AND_MIGRATIONS.md](./RELEASES_AND_MIGRATIONS.md)           | الإصدارات والهجرات والرجوع                                        |
| [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)                             | النسخ الاحتياطي واختبار الاستعادة                                 |
| [RUNBOOKS.md](./RUNBOOKS.md)                                         | الاستجابة للأعطال والحوادث الأمنية                                |
| [LEGACY_MIGRATION.md](./LEGACY_MIGRATION.md)                         | نقل البيانات من النظام السابق                                     |
| [WORKER_OPERATIONS.md](./WORKER_OPERATIONS.md)                       | الطوابير، الصور، PDF والإشعارات                                   |
| [PRODUCT_AND_DECISIONS.md](./PRODUCT_AND_DECISIONS.md)               | ملخص المرحلة صفر وقرارات المنتج/ADRs                              |
| [ASSETS.md](./ASSETS.md)                                             | أصول الهوية المولّدة ومصدرها وتعليمات إعادة إنتاجها               |
| [الخطة الهندسية العربية](./product/BHD-R-BUILD-PLAN-AR.md)           | الخطة المعتمدة الكاملة ومراحل البناء                              |
| [حزمة المرحلة صفر](./phase-0/00-README.md)                           | تعريف المنتج، الرحلات، الصلاحيات، المجال، التهديدات وADRs الأصلية |

الوثائق تصف هدفاً إنتاجياً، لكن لا تعني أن البنية التحتية الخارجية أو مفاتيح الدفع دُوّرت. تلك الإجراءات تُنفذ فقط بصلاحيات بيئة الإنتاج وسجل تغيير معتمد.
