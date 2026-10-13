import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { NOTE_TRANSLATE_MAX, noteLanguage, otherLanguage } from '@/lib/note-translation';
import { assistNote } from '@/lib/note-translate-ai';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z
  .object({
    text: z.string().trim().min(2).max(NOTE_TRANSLATE_MAX),
  })
  .strict();

/**
 * POST as-you-type help for owner-portal notes (transfers, refunds, handovers, contracts):
 * a translation into the other language plus a corrected and a reworded version.
 */
export async function POST(request: Request) {
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-note-assist', claims.sub, clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const source = noteLanguage(body.text);
  try {
    const result = await assistNote(
      { oidcToken: request.headers.get('x-vercel-oidc-token') },
      { text: body.text, source, target: otherLanguage(source) },
    );
    return NextResponse.json({ ...result, source, target: otherLanguage(source) });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'ai_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
