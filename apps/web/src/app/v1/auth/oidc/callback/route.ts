import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Without a public Nest API, OIDC callback cannot create a BHD R product session.
 * Show an actionable message instead of DNS_HOSTNAME_RESOLVED_PRIVATE.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? '';
  const hasPublicApi =
    /^https:\/\//i.test(apiOrigin) &&
    !/localhost|127\.0\.0\.1|\.local|\.internal/i.test(apiOrigin);

  if (hasPublicApi) {
    const upstream = new URL(`/v1/auth/oidc/callback${url.search}`, apiOrigin);
    return NextResponse.redirect(upstream);
  }

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BHD R · يتطلب API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
    code { background: #f4f4f5; padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>تم استلام رد الهوية، لكن API غير منشور</h1>
  <p>
    الواجهة على Vercel تعمل، لكن مسار <code>/v1/auth/oidc/callback</code> يحتاج خدمة
    <strong>NestJS API</strong> وقاعدة PostgreSQL لإنشاء جلسة المنتج.
  </p>
  <ol>
    <li>انشر <code>apps/api</code> على استضافة عامة (Render / Fly / Railway / Docker).</li>
    <li>اضبط على مشروع الويب: <code>API_INTERNAL_ORIGIN=https://your-api.example</code></li>
    <li>سجّل عميل <code>bhd-r</code> في هوية BHD مع redirect مطابق.</li>
  </ol>
  <p><a href="/ar/login">العودة لصفحة الدخول</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
