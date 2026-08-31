import { NextResponse } from 'next/server';
import { createCsrfToken } from '@bhd-r/security';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { isProductionRuntime, requireCsrfSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/csrf — issue CSRF on the Next/Vercel host (no Nest/Render).
 * Required for Neon owner writes when Nest is slow or unreachable.
 */
export async function GET(request: Request) {
  try {
    const claims = await requireLiveSession(request, { requireCsrf: false });
    const token = createCsrfToken(claims.sid, requireCsrfSecret());
    const response = NextResponse.json({ token });
    response.cookies.set({
      name: 'bhd_r_csrf',
      value: token,
      httpOnly: false,
      secure: isProductionRuntime() || process.env.VERCEL === '1',
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
