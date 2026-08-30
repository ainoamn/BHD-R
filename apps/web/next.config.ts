import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const apiOrigin =
  process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? 'http://localhost:4000';
const mediaBaseUrl = new URL(process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:9000');
const mediaPattern = new URL(
  `${mediaBaseUrl.origin}${mediaBaseUrl.pathname.replace(/\/$/, '')}/**`,
);

function isPublicApiOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && process.env.VERCEL) return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const config: NextConfig = {
  // Vercel injects an adapter that skips next-server.js.nft.json; standalone + that combo
  // fails on Next 16.3+. Keep standalone for Docker/self-host only.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  outputFileTracingRoot: monorepoRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  ...(process.env.NODE_ENV === 'development' ? { allowedDevOrigins: ['127.0.0.1'] } : {}),
  transpilePackages: [
    '@bhd-r/ui',
    '@bhd-r/i18n',
    '@bhd-r/contracts',
    '@bhd-r/country-packs',
    '@bhd-r/authz',
    '@bhd-r/db',
    '@bhd-r/security',
  ],
  experimental: {
    optimizePackageImports: ['@bhd-r/ui'],
    // Soft nav feels SPA-like: keep recently visited portal segments warm on the client.
    // Soft nav keeps visited portal sections in the client router cache (WAZEN-like).
    staleTimes: {
      dynamic: 600,
      static: 900,
    },
  },
  images: {
    remotePatterns: [
      mediaPattern,
      ...(process.env.NODE_ENV === 'development' && mediaBaseUrl.origin !== 'http://localhost:9000'
        ? [new URL('http://localhost:9000/**')]
        : []),
    ],
    formats: ['image/avif', 'image/webp'],
  },
  async rewrites() {
    // Never proxy /v1 to localhost/private hosts on Vercel (DNS_HOSTNAME_RESOLVED_PRIVATE).
    if (process.env.VERCEL && !isPublicApiOrigin(apiOrigin)) return [];
    return [{ source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
