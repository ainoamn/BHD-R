import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { createDatabase, users } from '@bhd-r/db';
import {
  apiFetch,
  configuredApiOrigin,
  isNestApiConfiguredForRuntime,
  probeNestReady,
} from '@/lib/server-api';
import {
  createAuthenticatedViewingRequest,
  updatePropertyDepositOnNeon,
} from '@/lib/public-booking-neon';

async function loadViewerContact(userId: string): Promise<{ email: string; displayName: string }> {
  const { db } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    const user = await transaction.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true, displayName: true },
    });
    if (!user?.email) throw new Error('unauthorized');
    return {
      email: user.email.trim().toLowerCase(),
      displayName: (user.displayName || user.email).trim().slice(0, 160),
    };
  });
}

function asSubmissionId(idempotencyKey: string | null | undefined): string {
  if (idempotencyKey && /^[0-9a-f-]{36}$/i.test(idempotencyKey)) return idempotencyKey;
  return randomUUID();
}

/**
 * Prefer Nest public viewing (throttled + audit) when reachable; fall back to Neon.
 */
export async function createViewingRequestNestOrNeon(
  claims: SessionClaims,
  unitId: string,
  locale: 'ar' | 'en',
  options: { idempotencyKey?: string | null } = {},
): Promise<{ accepted: true; reference: string; status: string; via: 'nest' | 'neon' }> {
  const contact = await loadViewerContact(claims.sub);
  const submissionId = asSubmissionId(options.idempotencyKey);

  if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
    const origin = configuredApiOrigin();
    if (origin) {
      try {
        const response = await fetch(`${origin}/v1/public/units/${unitId}/viewing-requests`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            submissionId,
            unitId,
            displayName: contact.displayName,
            email: contact.email,
            locale,
            consent: true,
            notes:
              locale === 'ar' ? 'طلب معاينة من مستخدم مسجّل' : 'Viewing request from signed-in user',
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            accepted?: boolean;
            reference?: string;
            status?: string;
          };
          return {
            accepted: true,
            reference: payload.reference ?? `WEB-${submissionId}`,
            status: payload.status ?? 'requested',
            via: 'nest',
          };
        }
      } catch {
        /* fall through to Neon */
      }
    }
  }

  const neon = await createAuthenticatedViewingRequest(claims, unitId, locale, {
    idempotencyKey: options.idempotencyKey ?? submissionId,
  });
  return { ...neon, via: 'neon' };
}

/** Prefer Nest property deposit patch when reachable; fall back to Neon GUCs path. */
export async function updatePropertyDepositNestOrNeon(
  claims: SessionClaims,
  propertyId: string,
  body: { amountMinor: string; currency?: string },
  csrfToken: string | null,
  options: { idempotencyKey?: string | null } = {},
): Promise<{ ok: true; unitCount: number; via: 'nest' | 'neon' }> {
  const idempotencyKey =
    options.idempotencyKey && options.idempotencyKey.trim().length >= 16
      ? options.idempotencyKey.trim().slice(0, 200)
      : `deposit:${propertyId}:${asSubmissionId(null)}`;

  if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
    try {
      const result = await apiFetch<{ ok: true; unitCount: number }>(
        `/v1/portfolio/properties/${propertyId}/deposit`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          body: JSON.stringify({
            amountMinor: body.amountMinor,
            ...(body.currency ? { currency: body.currency } : {}),
          }),
        },
      );
      return { ok: true, unitCount: result.unitCount, via: 'nest' };
    } catch {
      /* fall through */
    }
  }
  const neon = await updatePropertyDepositOnNeon(claims, propertyId, body, {
    idempotencyKey,
  });
  return { ...neon, via: 'neon' };
}

/** Prefer Nest media delete when reachable; fall back to Neon+S3. */
export async function deleteMediaAssetNestOrNeon(
  claims: SessionClaims,
  assetId: string,
  csrfToken: string | null,
): Promise<{ ok: true; assetId: string; via: 'nest' | 'neon' }> {
  if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
    try {
      const result = await apiFetch<{ ok: true; assetId: string }>(`/v1/media/${assetId}`, {
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
      });
      return { ok: true, assetId: result.assetId ?? assetId, via: 'nest' };
    } catch {
      /* fall through */
    }
  }
  const { deleteUnitMediaAsset } = await import('@/lib/upload-property-media-neon');
  const removed = await deleteUnitMediaAsset(claims, assetId);
  if (!removed) throw new Error('not_found');
  return { ok: true, assetId, via: 'neon' };
}

export function hashIdempotencyPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
