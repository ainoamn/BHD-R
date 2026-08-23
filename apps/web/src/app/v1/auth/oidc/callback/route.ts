import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Legacy path — forward code/state to canonical BHD product SSO callback. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL('/api/auth/bhd/callback', url.origin);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  return NextResponse.redirect(target, 302);
}
