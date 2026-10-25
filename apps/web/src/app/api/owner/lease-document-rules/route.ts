import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { REQUIREMENT_CATALOGUE } from '@/lib/lease-reservation-lifecycle';
import {
  loadOwnerLeaseDocumentRules,
  saveLeaseDocumentRules,
} from '@/lib/lease-document-rules-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { ownerPartyScope } from '@/lib/portal-ops-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const profileCodes = z
  .array(z.string().trim().min(1).max(64))
  .max(12)
  .refine(
    (codes) =>
      codes.every(
        (code) =>
          REQUIREMENT_CATALOGUE.some((item) => item.code === code) || /^custom_\d+$/.test(code),
      ),
    { message: 'unknown_code' },
  );

const rulesSchema = z
  .object({
    person_omani: profileCodes,
    person_expat: profileCodes,
    company_base: profileCodes,
    company_signatory_omani: profileCodes,
    company_signatory_expat: profileCodes,
  })
  .strict();

const bodySchema = z
  .object({
    propertyId: z.string().uuid().nullable(),
    rules: rulesSchema.nullable(),
  })
  .strict();

/** GET /api/owner/lease-document-rules?propertyId= — matrix for org or one property. */
export async function GET(request: Request) {
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
  if (!claims.organizationId || !claims.permissions.includes('reservation.read')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const url = new URL(request.url);
  const raw = url.searchParams.get('propertyId');
  const propertyId = raw && z.string().uuid().safeParse(raw).success ? raw : null;
  try {
    const view = await loadOwnerLeaseDocumentRules(
      {
        organizationId: claims.organizationId,
        userId: claims.sub,
        partyId: ownerPartyScope(claims),
        roles: claims.roles,
      },
      propertyId,
    );
    return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/**
 * PUT /api/owner/lease-document-rules
 * Which uploads each tenant profile must provide. `rules` null clears the override.
 */
export async function PUT(request: Request) {
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
  if (!claims.organizationId || !claims.permissions.includes('reservation.manage')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-lease-document-rules', claims.sub, clientIp(request)]),
    limit: 20,
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

  try {
    return NextResponse.json(await saveLeaseDocumentRules(claims, body.propertyId, body.rules), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('PUT /api/owner/lease-document-rules', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
