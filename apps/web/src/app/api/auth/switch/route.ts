import { NextResponse } from 'next/server';
import { identitySettings, safeReturnTo } from '@/lib/bhd/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/switch?sub=… — product bridge to identity multi-account switch.
 * Identity owns `bhd_id` / roster; products cannot fetch identity APIs (CORP).
 * Top-level navigation: identity GET switch → return_to product silent start.
 * See docs/patches/identity-auth-switch-get.md
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sub = (url.searchParams.get('sub') || '').trim();
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const returnPath = safeReturnTo(
    url.searchParams.get('returnTo'),
    `/${locale}/portal`,
  );

  if (!sub || sub.length < 8) {
    return NextResponse.redirect(new URL(`/${locale}/portal`, url.origin), 303);
  }

  const { issuer } = identitySettings(url.origin);
  const productStart = new URL('/api/auth/bhd/start', url.origin);
  productStart.searchParams.set('returnTo', returnPath);

  const identitySwitch = new URL(`${issuer}/api/auth/switch`);
  identitySwitch.searchParams.set('sub', sub);
  identitySwitch.searchParams.set('return_to', productStart.toString());

  return NextResponse.redirect(identitySwitch.toString(), 303);
}
