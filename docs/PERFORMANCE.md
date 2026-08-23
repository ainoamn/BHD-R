# الأداء: سرعة الموقع وميزانياته

## ميزانيات الصفحات العامة (p75 mobile)

- LCP أقل من 2.0s، CLS أقل من 0.1، INP أقل من 200ms ميدانياً.
- TTFB أقل من 500ms من المنطقة المستهدفة.
- JavaScript أولي target ≤ 150KB gzip للصفحة العامة.
- صورة LCP responsive AVIF/WebP، لا تتجاوز أبعاد العرض، target ≤ 180KB.
- API public search p95 ≤ 250ms cached و≤ 500ms uncached.

`lighthouserc.cjs` و`.github/lighthouse-budget.json` يثبتان حدود المختبر. INP يحتاج RUM؛ CI يستخدم Total Blocking Time proxy.

## Web

- Server Components افتراضياً، Client Components للتفاعل الضروري فقط.
- pre-render/ISR للصفحات التسويقية وlisting public، CDN cache بـ surrogate key لإبطال عقار محدد.
- `next/image`/`picture` مع `srcset`, sizes, width/height، AVIF ثم WebP. preload لصورة LCP الوحيدة فقط.
- fonts محلية subset عربية/لاتينية و`font-display: swap`; لا طلبات خط خارجية.
- lazy-load الخرائط، الرسوم، المحرر ولوحات الإدارة؛ لا تشحنها للصفحة الرئيسية.
- لا hydrate جداول كبيرة؛ cursor pagination وvirtualization عند الحاجة.

## API وDB

- قس قبل إضافة cache. فهارس مركبة تبدأ بـ`organization_id`، وفهارس partial للحالات النشطة/المنشورة.
- public availability query تعتمد range/constraint واضحاً وتمنع N+1؛ راقب `EXPLAIN (ANALYZE, BUFFERS)` على بيانات مماثلة للإنتاج.
- statement timeout، cursor pagination، select حقول محددة، connection pooling. لا `SELECT *` في المسارات الحارة.
- Redis للنتائج القابلة لإعادة البناء، key version + locale/country + public filters، TTL قصير وstampede lock.
- تقارير وPDF وصور عبر Worker. API يعيد `202` وjob ID بدلاً من حبس request.

## الصور

الأصل private. Worker يزيل EXIF، يفحص الحجم/pixels/malware، يضيف علامة BHD R الرسمية ويولد AVIF وWebP بعروض 480/960/1600 مع cache immutable وأسماء content-hash. بيانات variants (`key,width,height,format,bytes`) تبني `picture/srcset` بلا HEAD requests.

## المراقبة

RUM يقيس Web Vitals حسب route/locale/device من دون PII. traces تربط Web→API→DB/queue بـcorrelation ID. Alerts على p95/p99 وerror/queue lag وDB saturation، لا على averages فقط. performance regression يمنع الدمج عندما يتجاوز budget باستمرار؛ التنازل له owner وموعد انتهاء.
