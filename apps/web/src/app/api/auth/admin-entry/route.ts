import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Safe admin landing — copied from ONE-BHD admin-entry (BHD-PRODUCT-SSO-ADMIN §3.1 / §4.9). */
function adminReturnTo(request: Request): string {
  let raw = new URL(request.url).searchParams.get('next')?.trim() || '/admin';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\')) {
    return '/admin';
  }
  if (raw === '/site-admin' || raw.startsWith('/site-admin/')) {
    raw = raw.replace(/^\/site-admin/, '/admin');
  }
  // Site/system control only — never land admins inside owner/tenant portals by mistake.
  if (
    raw === '/platform' ||
    raw.startsWith('/platform/') ||
    raw.startsWith('/owner/') ||
    raw.startsWith('/tenant/') ||
    raw.startsWith('/developer/')
  ) {
    return '/admin';
  }
  return raw;
}

/**
 * Never send admins to `?local=1` password login.
 * Forwards to BHD start so the same identity session opens the admin console.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const returnTo = adminReturnTo(request);
  return NextResponse.redirect(
    new URL(`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`, origin),
  );
}
