import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { createAuthenticatedViewingRequest } from '@/lib/public-booking-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  unitId: z.string().uuid(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

/** POST /api/public/viewing-requests — signed-in visitor requests a viewing. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await createAuthenticatedViewingRequest(claims, body.unitId, body.locale);
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'request_failed';
    const status =
      code === 'unit_unavailable' || code === 'not_found'
        ? 404
        : code === 'forbidden'
          ? 403
          : 500;
    return NextResponse.json({ error: { code } }, { status });
  }
}
