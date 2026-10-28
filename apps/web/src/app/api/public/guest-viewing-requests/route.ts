import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import {
  configuredApiOrigin,
  isNestApiConfiguredForRuntime,
  probeNestReady,
} from '@/lib/server-api';
import {
  findViewingNotifyTarget,
  notifyOwnersOfViewingRequest,
  tryAutoScheduleViewingRequest,
} from '@/lib/viewing-requests-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    submissionId: z.string().uuid(),
    unitId: z.string().uuid(),
    displayName: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(6).max(40).optional(),
    preferredAt: z.string().datetime().optional(),
    notes: z.string().trim().max(2000).optional(),
    locale: z.enum(['ar', 'en']).default('ar'),
    consent: z.literal(true),
    website: z.string().optional(),
  })
  .strict();

/**
 * POST /api/public/guest-viewing-requests
 * Anonymous listing form: Nest-first create, then optional auto-schedule from org policy.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['guest-viewing', clientIp(request)]),
    limit: 8,
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
  if (body.website) {
    return NextResponse.json({ accepted: true, reference: 'ok', status: 'requested' });
  }

  try {
    let reference: string | null = null;
    let status = 'requested';
    if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
      const origin = configuredApiOrigin();
      if (origin) {
        const response = await fetch(`${origin}/v1/public/units/${body.unitId}/viewing-requests`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            submissionId: body.submissionId,
            unitId: body.unitId,
            displayName: body.displayName,
            email: body.email,
            phone: body.phone,
            preferredAt: body.preferredAt,
            notes: body.notes,
            locale: body.locale,
            consent: true,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            reference?: string;
            status?: string;
          };
          reference = payload.reference ?? `WEB-${body.submissionId}`;
          status = payload.status ?? 'requested';
        }
      }
    }
    if (!reference) {
      return NextResponse.json({ error: { code: 'request_failed' } }, { status: 502 });
    }

    const target = await findViewingNotifyTarget(reference, body.unitId).catch(() => null);
    let autoScheduled = false;
    if (target) {
      void notifyOwnersOfViewingRequest({
        viewingId: target.viewingId,
        organizationId: target.organizationId,
        unitId: target.unitId,
        reference: target.reference,
      });
      if (body.preferredAt) {
        autoScheduled = await tryAutoScheduleViewingRequest(target.viewingId).catch(() => false);
        if (autoScheduled) status = 'scheduled';
      }
    }

    return NextResponse.json({
      accepted: true,
      reference,
      status,
      autoScheduled,
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'request_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
