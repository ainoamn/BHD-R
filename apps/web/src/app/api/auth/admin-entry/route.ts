import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Safe admin landing — copied from ONE-BHD admin-entry (BHD-PRODUCT-SSO-ADMIN §3.1 / §4.9). */
function adminReturnTo(request: Request): string {
  const raw = new URL(request.url).searchParams.get('next')?.trim() || '/platform';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\')) {
    return '/platform';
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
