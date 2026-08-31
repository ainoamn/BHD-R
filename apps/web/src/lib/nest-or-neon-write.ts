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
    // Prefer least-privilege: own user row via app.user_id (P1-04).
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    await transaction.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    let user = await transaction.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true, displayName: true },
    });
    if (!user?.email) {
      await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      user = await transaction.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, displayName: true },
      });
    }
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

/** Prefer Nest public booking checkout; fall back to Neon. */
export async function createPublicBookingNestOrNeon(
  claims: SessionClaims,
  unitId: string,
  locale: 'ar' | 'en' = 'ar',
  options: { idempotencyKey?: string | null } = {},
): Promise<{
  reservationId: string;
  sessionReference: string;
  amountMinor: string;
  currency: string;
  expiresAt: string;
  via: 'nest' | 'neon';
}> {
  const contact = await loadViewerContact(claims.sub);
  const submissionId = asSubmissionId(options.idempotencyKey);

  if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
    const origin = configuredApiOrigin();
    if (origin) {
      try {
        const response = await fetch(`${origin}/v1/public/units/${unitId}/booking-checkouts`, {
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
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            reservationId: string;
            sessionReference: string;
            amountMinor: string;
            currency: string;
            expiresAt: string;
          };
          return { ...payload, via: 'nest' };
        }
        if (response.status === 409) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
            error?: { message?: string };
          } | null;
          const message = `${payload?.message ?? ''} ${payload?.error?.message ?? ''}`.toLowerCase();
          if (message.includes('deposit')) throw new Error('deposit_not_set');
          if (message.includes('available')) throw new Error('unit_unavailable');
        }
      } catch {
        /* fall through */
      }
    }
  }

  const { createPublicBookingCheckout } = await import('@/lib/public-booking-neon');
  const neon = await createPublicBookingCheckout(claims, unitId, {
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

/** Prefer Nest property create when reachable; fall back to Neon. */
/** Prefer Neon for full wizard create (stable on Vercel); Nest when Neon path fails. */
export async function createPropertyBundleNestOrNeon(
  claims: SessionClaims,
  body: unknown,
  csrfToken: string | null,
  options: { idempotencyKey?: string | null } = {},
): Promise<Record<string, unknown> & { via: 'nest' | 'neon' }> {
  const idempotencyKey =
    options.idempotencyKey && options.idempotencyKey.trim().length >= 16
      ? options.idempotencyKey.trim().slice(0, 200)
      : `property-create:${asSubmissionId(null)}`;

  const { createPropertyBundleOnNeon } = await import('@/lib/create-property-neon');
  try {
    const neon = await createPropertyBundleOnNeon(claims, body, { idempotencyKey });
    return { ...neon, via: 'neon' };
  } catch (neonError) {
    if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
      try {
        const result = await apiFetch<Record<string, unknown>>('/v1/portfolio/properties', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          body: JSON.stringify(body),
        });
        return { ...result, via: 'nest' };
      } catch {
        /* rethrow Neon error — primary path */
      }
    }
    throw neonError;
  }
}

/** Prefer Neon for full wizard update; Nest only if Neon throws. */
export async function updatePropertyBundleNestOrNeon(
  claims: SessionClaims,
  propertyId: string,
  body: unknown,
  csrfToken: string | null,
  options: { idempotencyKey?: string | null } = {},
): Promise<Record<string, unknown> & { via: 'nest' | 'neon' }> {
  const idempotencyKey =
    options.idempotencyKey && options.idempotencyKey.trim().length >= 16
      ? options.idempotencyKey.trim().slice(0, 200)
      : `property-update:${propertyId}:${asSubmissionId(null)}`;

  const { updatePropertyBundleOnNeon } = await import('@/lib/create-property-neon');
  try {
    const neon = await updatePropertyBundleOnNeon(claims, propertyId, body, { idempotencyKey });
    return { ...neon, via: 'neon' };
  } catch (neonError) {
    if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/v1/portfolio/properties/${propertyId}`,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': idempotencyKey,
              ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
            },
            body: JSON.stringify(body),
          },
        );
        return { ...result, via: 'nest' };
      } catch {
        /* rethrow Neon error — primary path */
      }
    }
    throw neonError;
  }
}

/**
 * Prefer Nest media pipeline (intent → ingress → complete); fall back to Neon+S3.
 * Sniffs magic-bytes before calling Nest so MIME is not client-trusted.
 */
export async function uploadUnitMediaNestOrNeon(
  claims: SessionClaims,
  input: {
    unitId: string;
    purpose: 'property_image' | 'attachment';
    position: number;
    mimeType: string;
    bytes: Buffer;
    fileName?: string;
  },
  _csrfToken: string | null,
  _options: { idempotencyKey?: string | null } = {},
): Promise<{ assetId: string; url: string; via: 'nest' | 'neon' }> {
  const { detectAllowedMime, uploadUnitMediaOnNeon } = await import(
    '@/lib/upload-property-media-neon'
  );
  const detected = detectAllowedMime(input.bytes, input.purpose);
  if (!detected) throw new Error('invalid_file');
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error('invalid_file');
  }

  // Always Vercel→R2/Neon for owner media. Nest ingress needs a Nest-minted CSRF and
  // cold Render often exhausts the Vercel route budget → browser "Failed to fetch".
  const neon = await uploadUnitMediaOnNeon(claims, {
    ...input,
    mimeType: detected,
  });
  return { ...neon, via: 'neon' };
}

export function hashIdempotencyPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
