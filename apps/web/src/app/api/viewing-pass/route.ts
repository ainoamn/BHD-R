import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { contractQrSvg } from '@/lib/contract-verify';
import { appLink } from '@/lib/email-notify';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  cancelViewingGuestVisit,
  loadViewingGuestPass,
  recordViewingGuestDecision,
  requestViewingGuestReschedule,
} from '@/lib/viewing-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tokenSchema = z.string().min(40).max(120);

const postSchema = z.union([
  z
    .object({
      action: z.literal('decision'),
      token: tokenSchema,
      decision: z.enum(['book_rent', 'book_sale', 'declined']),
    })
    .strict(),
  z
    .object({
      action: z.literal('reschedule'),
      token: tokenSchema,
      preferredAt: z.string().min(8).max(40),
      note: z.string().max(500).optional().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel'),
      token: tokenSchema,
      note: z.string().max(500).optional().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('not_attending'),
      token: tokenSchema,
      note: z.string().max(500).optional().nullable(),
    })
    .strict(),
  /** Backward-compatible body used by older pass UIs. */
  z
    .object({
      token: tokenSchema,
      decision: z.enum(['book_rent', 'book_sale', 'declined']),
    })
    .strict(),
]);

/** GET /api/viewing-pass?t=… — guest pass payload + QR (no login). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['viewing-pass-get', clientIp(request)]),
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const url = new URL(request.url);
  const token = tokenSchema.safeParse(url.searchParams.get('t') ?? '');
  if (!token.success) {
    return NextResponse.json({ error: { code: 'invalid_token' } }, { status: 400 });
  }
  try {
    const pass = await loadViewingGuestPass(token.data);
    if (!pass) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    const gateUrl = appLink(`/ar/viewing-gate?t=${encodeURIComponent(pass.token)}`);
    const qrSvg = await contractQrSvg(gateUrl).catch(() => null);
    return NextResponse.json(
      { ...pass, qrSvg, gateUrl },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/**
 * POST /api/viewing-pass — guest actions from the visit pass:
 * decision (after check-in), reschedule request, cancel, or not attending.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['viewing-pass-post', clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    const body = parsed.data;
    if ('decision' in body && !('action' in body)) {
      const pass = await recordViewingGuestDecision(body.token, body.decision);
      return NextResponse.json(pass, { headers: { 'cache-control': 'no-store' } });
    }
    if (body.action === 'decision') {
      const pass = await recordViewingGuestDecision(body.token, body.decision);
      return NextResponse.json(pass, { headers: { 'cache-control': 'no-store' } });
    }
    if (body.action === 'reschedule') {
      const pass = await requestViewingGuestReschedule(
        body.token,
        body.preferredAt,
        body.note ?? null,
      );
      return NextResponse.json(pass, { headers: { 'cache-control': 'no-store' } });
    }
    const result = await cancelViewingGuestVisit(
      body.token,
      body.action === 'not_attending' ? 'not_attending' : 'cancel',
      body.note ?? null,
    );
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'decision_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
