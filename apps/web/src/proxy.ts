import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);
const mediaOrigin = new URL(process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:9000').origin;

function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${mediaOrigin}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https://www.google.com https://maps.google.com https://www.google.com/maps",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export default function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp(nonce));
  const response = intlMiddleware(new NextRequest(request.url, { headers: requestHeaders }));
  response.headers.set('Content-Security-Policy', csp(nonce));
  return response;
}

export const config = {
  matcher: ['/((?!api|v1|_next|.*\\..*).*)'],
};
