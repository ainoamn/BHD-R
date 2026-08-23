# BHD Identity والدخول الموحد

## الإعداد

- issuer: `https://id.bhd-om.com` في الإنتاج.
- OIDC client: `bhd-r`، confidential authorization-code client.
- Authorization Code + PKCE S256، مع `state` و`nonce` أحاديي الاستخدام.
- redirect URIs allowlist حرفي لكل بيئة، ولا wildcard.
- التحقق عبر JWKS بخوارزمية RS256/ES256، مع `iss`, `aud`, `exp`, `iat`, `nonce`; لا تقبل `none` أو HS256 كتوافق مؤقت.

## تدفق الدخول

1. `/v1/auth/login` ينشئ state/nonce/PKCE verifier في تخزين قصير مشفر ويرسل المتصفح للهوية.
2. callback يطابق state ويستبدل code server-side ويتحقق من ID token/JWKS.
3. اربط `sub` بهوية داخلية. لا تستخدم email كمفتاح ثابت.
4. اختر العضوية/المؤسسة المسموحة وأنشئ product session قصيرة في Cookie آمنة.
5. audit يسجل النجاح/الفشل وIDs فقط، لا code/token/claims الكاملة.

JWKS cache يحترم TTL ويدعم refresh عند `kid` غير معروف مع rate limit لمنع DoS. clock skew محدود. عند تعطل IdP لا تضف bypass؛ الجلسات القائمة تتبع TTL وسياسة المخاطر.

في التطوير المحلي، redirect URI هو `http://localhost:3000/v1/auth/oidc/callback` وليس منفذ API. Web يمرر `/v1` داخلياً إلى API، لذلك state cookie وsession cookie تبقيان same-origin. في الإنتاج تستخدم `https://r.bhd-om.com/v1/auth/oidc/callback` أو النطاق المعتمد، وتبقى `COOKIE_SECURE=true`.

## تهيئة المستأجر

بعد تفعيل الإيجار، تنشئ المنصة invite/activation أحادي الاستخدام مرتبطاً بالمستأجر والعضوية. يُرسل username/تعريف الحساب مع رابط activation قصير، **ولا ترسل كلمة مرور دائمة**. يحدد العميل credential داخل BHD Identity أو يستخدم العامل المعتمد. انتهاء/استخدام الرابط يبطلانه، وإعادة الدعوة تلغي السابق.

## الجلسات والإلغاء

جلسة المنتج تحتوي `sessionId`, `subject`, `membershipId`, `organizationId`, `sessionVersion`, `issuedAt`, `authTime`. API يقارن session version بذاكرة/DB. logout يلغي الجلسة الحالية؛ “logout all”, password reset, account disable وrole downgrade تلغي الكل. refresh token rotation مع reuse detection.

## الأدوار المتعددة

الدخول موحد لكن authorization منتجّي. platform admin لا يصبح owner تلقائياً، والمطور/المالك/المستأجر يرى فقط membership/resource grants الخاصة به. تغيير المؤسسة عملية صريحة، يولد session context جديداً وCSRF جديداً ولا يقبل `organization_id` من query لتجاوزها.

## Service-to-service

لا تستخدم user session. استخدم OAuth client credentials أو workload identity مع audience خاص وscopes ضيقة. API keys legacy فقط: prefix علني + secret عشوائي، hash في DB، expiry/scopes/last-used/revocation، ولا تعرض السر إلا مرة.
