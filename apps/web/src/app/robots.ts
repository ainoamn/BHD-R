import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.PUBLIC_WEB_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://r.bhd-om.com';
  return {
    rules: {
      userAgent: '*',
      allow: ['/ar/', '/en/'],
      disallow: [
        '/v1/',
        '/ar/platform/',
        '/en/platform/',
        '/ar/owner/',
        '/en/owner/',
        '/ar/developer/',
        '/en/developer/',
        '/ar/tenant/',
        '/en/tenant/',
        '/ar/portal',
        '/en/portal',
        '/ar/login',
        '/en/login',
        '/ar/activate',
        '/en/activate',
        '/ar/forgot-password',
        '/en/forgot-password',
        '/ar/reset-password',
        '/en/reset-password',
        '/ar/invoice/',
        '/en/invoice/',
        '/ar/payments/',
        '/en/payments/',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
