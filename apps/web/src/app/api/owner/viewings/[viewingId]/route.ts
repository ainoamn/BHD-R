import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { loadViewingRequestForStaff, respondToViewingRequest } from '@/lib/viewing-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    action: z.enum(['schedule', 'complete', 'cancel', 'no_show', 'reply']),
    scheduledAt: z.string().min(10).max(40).optional().nullable(),
    note: z.string().max(4000).optional().nullable(),
  })
  .strict();

/** GET /api/owner/viewings/:viewingId — viewing request detail for the owner desk. */
export async function GET(request: Request, context: { params: Promise<{ viewingId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { viewingId } = await context.params;
  if (!z.string().uuid().safeParse(viewingId).success) {
    return NextResponse.json({ error: { code: 'invalid_id' } }, { status: 400 });
  }
  try {
    const detail = await loadViewingRequestForStaff(claims, viewingId);
    if (!detail) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/**
 * POST /api/owner/viewings/:viewingId — schedule a viewing (date/time + notes), reply, complete,
 * cancel, or mark no-show.
 */
export async function POST(request: Request, context: { params: Promise<{ viewingId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-viewing', claims.sub, clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { viewingId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(viewingId).success) {
    return NextResponse.json({ error: { code: 'viewing_invalid' } }, { status: 400 });
  }
  try {
    const detail = await respondToViewingRequest(claims, viewingId, {
      action: parsed.data.action,
      scheduledAt: parsed.data.scheduledAt ?? null,
      note: parsed.data.note ?? null,
    });
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/viewings/:id', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
