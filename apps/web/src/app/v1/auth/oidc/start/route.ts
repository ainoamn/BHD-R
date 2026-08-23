import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Legacy path — redirect to canonical BHD product SSO start. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('returnTo');
  const target = new URL('/api/auth/bhd/start', url.origin);
  if (returnTo) target.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(target, 302);
}
