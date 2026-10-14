import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { addTenantRequestMedia } from '@/lib/tenant-requests-neon';
import {
  REQUEST_PHOTO_UPLOAD_MAX_BYTES,
  REQUEST_VIDEO_MAX_BYTES,
  isRequestMediaStage,
} from '@/lib/tenant-requests-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = Math.max(REQUEST_VIDEO_MAX_BYTES, REQUEST_PHOTO_UPLOAD_MAX_BYTES);

/**
 * POST /api/tenant/requests/:requestId/media?stage=report|work|after|selfie
 * The raw bytes of one photo or short video. `report` is the tenant adding to their own request;
 * the other stages are the maintenance team's work photos and the closing proof.
 */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
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
    key: hashRateKey(['tenant-request-media', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { requestId } = await context.params;
  const stage = new URL(request.url).searchParams.get('stage');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (
    !z.string().uuid().safeParse(requestId).success ||
    !isRequestMediaStage(stage) ||
    declared > MAX_BODY
  ) {
    return NextResponse.json({ error: { code: 'tenant_request_media' } }, { status: 400 });
  }
  const body = Buffer.from(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!body.byteLength || body.byteLength > MAX_BODY) {
    return NextResponse.json({ error: { code: 'tenant_request_media' } }, { status: 400 });
  }
  try {
    const added = await addTenantRequestMedia(claims, requestId, {
      bytes: body,
      stage,
      side: stage === 'report' ? 'tenant' : 'team',
    });
    return NextResponse.json(added, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/tenant/requests/:id/media', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
