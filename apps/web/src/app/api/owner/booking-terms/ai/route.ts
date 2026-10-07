import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { TERMS_MAX_CLAUSE } from '@/lib/booking-terms';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { proofreadTerm, rephraseTerm, translateTerms } from '@/lib/terms-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const lang = z.enum(['ar', 'en']);
const kind = z.enum(['heading', 'clause']);
const text = z.string().trim().min(1).max(TERMS_MAX_CLAUSE);

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('translate'),
      from: lang,
      items: z.array(z.object({ kind, text }).strict()).min(1).max(40),
    })
    .strict(),
  z
    .object({
      action: z.literal('rephrase'),
      lang,
      kind,
      text,
      mode: z.enum(['sale', 'rent', 'daily']),
    })
    .strict(),
  z.object({ action: z.literal('proofread'), lang, kind, text, uiLang: lang }).strict(),
]);

const MODE_NAME = {
  sale: 'property sale reservation',
  rent: 'residential monthly/yearly lease reservation',
  daily: 'short-term daily rental',
} as const;

/** POST AI help for owner terms: legal translation, rephrasing, and proofreading. */
export async function POST(request: Request) {
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId || !claims.permissions.includes('property.update')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-terms-ai', claims.sub, clientIp(request)]),
    limit: 30,
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

  const context = { oidcToken: request.headers.get('x-vercel-oidc-token') };
  try {
    if (body.action === 'translate') {
      return NextResponse.json(await translateTerms(context, body));
    }
    if (body.action === 'rephrase') {
      return NextResponse.json(
        await rephraseTerm(context, { ...body, mode: MODE_NAME[body.mode] }),
      );
    }
    return NextResponse.json(await proofreadTerm(context, body));
  } catch (error) {
    const code = clientSafeErrorCode(error, 'ai_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
