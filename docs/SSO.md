# BHD Identity والدخول الموحد

المصدر المعتمد للمجموعة: [ONE-BHD / BHD-IDENTITY-SSO.md](https://github.com/ainoamn/ONE-BHD/blob/main/docs/BHD-IDENTITY-SSO.md)  
إعداد BHD R على Vercel: [BHD-R-IDENTITY-SETUP.md](./BHD-R-IDENTITY-SETUP.md)

## الإعداد

- issuer: `https://id.bhd-om.com` في الإنتاج.
- OIDC client: `bhd-r` (سجّله في `BHD_OAUTH_CLIENTS` على مشروع الهوية؛ الاكتشاف الحي قد لا يعرضه حتى يُضاف).
- أسماء المتغيرات المدعومة: `BHD_IDENTITY_*` و`BHD_OAUTH_*` (مرادفات ONE-BHD).
- Authorization Code + PKCE S256، مع `state` و`nonce` أحاديي الاستخدام.
- redirect URIs allowlist حرفي لكل بيئة، ولا wildcard.
- التحقق: JWKS من `{issuer}/oauth/jwks.json` بخوارزمية RS256/ES256؛ احتياطي HS256 عبر `BHD_IDENTITY_TOKEN_SECRET` بينما JWKS غير جاهز (حسب مواصفة الهوية).
- لا تقبل خوارزمية `none`.

## تدفق الدخول

1. `/v1/auth/oidc/start` ينشئ state/nonce/PKCE verifier في كوكي `bhd_r_oidc` ويرسل المتصفح إلى `{issuer}/oauth/authorize`.
2. callback يطابق state ويستبدل code server-side ويتحقق من ID token.
3. اربط `sub` بهوية داخلية (`users.identitySubject`). لا تستخدم email كمفتاح ثابت.
4. اختر العضوية/المؤسسة المسموحة وأنشئ product session قصيرة في Cookie آمنة.
5. audit يسجل النجاح/الفشل وIDs فقط، لا code/token/claims الكاملة.

على Vercel: لا تضبط `API_INTERNAL_ORIGIN` على `localhost` — يظهر `DNS_HOSTNAME_RESOLVED_PRIVATE`. انشر Nest API بعنوان HTTPS عام ثم أعد البناء.

JWKS cache يحترم TTL ويدعم refresh عند `kid` غير معروف مع rate limit لمنع DoS. clock skew محدود. عند تعطل IdP لا تضف bypass؛ الجلسات القائمة تتبع TTL وسياسة المخاطر.

في التطوير المحلي، redirect URI هو `http://localhost:3000/v1/auth/oidc/callback` وليس منفذ API. Web يمرر `/v1` داخلياً إلى API، لذلك state cookie وsession cookie تبقيان same-origin. في الإنتاج تستخدم `https://r.bhd-om.com/v1/auth/oidc/callback` أو النطاق المعتمد (مثل `https://bhd-r-api-phi.vercel.app/v1/auth/oidc/callback`)، وتبقى `COOKIE_SECURE=true`.

## تهيئة المستأجر

بعد تفعيل الإيجار، تنشئ المنصة invite/activation أحادي الاستخدام مرتبطاً بالمستأجر والعضوية. يُرسل username/تعريف الحساب مع رابط activation قصير، **ولا ترسل كلمة مرور دائمة**. يحدد العميل credential داخل BHD Identity أو يستخدم العامل المعتمد. انتهاء/استخدام الرابط يبطلانه، وإعادة الدعوة تلغي السابق.

## الجلسات والإلغاء

جلسة المنتج تحتوي `sessionId`, `subject`, `membershipId`, `organizationId`, `sessionVersion`, `issuedAt`, `authTime`. API يقارن session version بذاكرة/DB. logout يلغي الجلسة الحالية؛ “logout all”, password reset, account disable وrole downgrade تلغي الكل. refresh token rotation مع reuse detection.

## الأدوار المتعددة

الدخول موحد لكن authorization منتجّي. platform admin لا يصبح owner تلقائياً، والمطور/المالك/المستأجر يرى فقط membership/resource grants الخاصة به. تغيير المؤسسة عملية صريحة، يولد session context جديداً وCSRF جديداً ولا يقبل `organization_id` من query لتجاوزها.

## Service-to-service

لا تستخدم user session. استخدم OAuth client credentials أو workload identity مع audience خاص وscopes ضيقة. API keys legacy فقط: prefix علني + secret عشوائي، hash في DB، expiry/scopes/last-used/revocation، ولا تعرض السر إلا مرة.
