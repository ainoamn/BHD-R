import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
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
  options: { idempotencyKey?: string | null; interest?: 'rent' | 'sale' | null } = {},
): Promise<{ accepted: true; reference: string; status: string; via: 'nest' | 'neon' }> {
  const contact = await loadViewerContact(claims.sub);
  const submissionId = asSubmissionId(options.idempotencyKey);
  const interest = options.interest === 'sale' || options.interest === 'rent' ? options.interest : null;
  const interestNote =
    interest === 'sale'
      ? locale === 'ar'
        ? 'اهتمام: شراء'
        : 'Interest: purchase'
      : interest === 'rent'
        ? locale === 'ar'
          ? 'اهتمام: تأجير'
          : 'Interest: rent'
        : null;
  const baseNote =
    locale === 'ar' ? 'طلب معاينة من مستخدم مسجّل' : 'Viewing request from signed-in user';
  const notes = interestNote ? `${baseNote} · ${interestNote}` : baseNote;

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
            notes,
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
    ...(options.interest ? { interest: options.interest } : {}),
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
 * Prefer Neon+S3 on Vercel; if storage is missing/unavailable, upload via Nest
 * server-to-server with Bearer session (skips CSRF); last resort Neon inline bytes.
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
    galleryScope?: 'building' | 'unit';
  },
  _csrfToken: string | null,
  options: { idempotencyKey?: string | null } = {},
): Promise<{ assetId: string; url: string; via: 'nest' | 'neon' }> {
  const { detectAllowedMime, uploadUnitMediaOnNeon } = await import(
    '@/lib/upload-property-media-neon'
  );
  const detected = detectAllowedMime(input.bytes, input.purpose);
  if (!detected) throw new Error('invalid_file');
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error('invalid_file');
  }

  try {
    const neon = await uploadUnitMediaOnNeon(claims, {
      ...input,
      mimeType: detected,
    });
    return { ...neon, via: 'neon' };
  } catch (neonError) {
    const code = neonError instanceof Error ? neonError.message : 'upload_failed';
    if (code !== 'storage_unavailable' && code !== 's3_unconfigured') {
      throw neonError instanceof Error ? neonError : new Error('upload_failed');
    }
  }

  if (isNestApiConfiguredForRuntime() && (await probeNestReady())) {
    const origin = configuredApiOrigin();
    if (origin) {
      try {
        const cookieStore = await cookies();
        const sessionToken = cookieStore.get('bhd_r_session')?.value?.trim();
        if (!sessionToken) throw new Error('unauthorized');

        const sha256 = createHash('sha256').update(input.bytes).digest('hex');
        const idempotencyKey =
          options.idempotencyKey && options.idempotencyKey.trim().length >= 16
            ? options.idempotencyKey.trim().slice(0, 200)
            : `media-complete:${asSubmissionId(null)}`;

        const nestHeaders: Record<string, string> = {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
        };
        if (claims.organizationId) {
          nestHeaders['x-organization-id'] = claims.organizationId;
        }

        const intentResponse = await fetch(`${origin}/v1/media/upload-intents`, {
          method: 'POST',
          headers: nestHeaders,
          body: JSON.stringify({
            purpose: input.purpose,
            unitId: input.unitId,
            mimeType: detected,
            byteSize: input.bytes.byteLength,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        });
        if (!intentResponse.ok) {
          const detail = await intentResponse.text().catch(() => '');
          console.error('Nest media intent failed', intentResponse.status, detail.slice(0, 300));
          throw new Error('upload_failed');
        }
        const intent = (await intentResponse.json()) as {
          assetId: string;
          uploadUrl: string;
          requiredHeaders?: { 'content-type'?: string };
        };

        const put = await fetch(intent.uploadUrl, {
          method: 'PUT',
          headers: {
            'content-type': intent.requiredHeaders?.['content-type'] ?? detected,
          },
          body: new Uint8Array(input.bytes),
          cache: 'no-store',
          signal: AbortSignal.timeout(45_000),
        });
        if (!put.ok) {
          console.error('Nest media ingress PUT failed', put.status);
          throw new Error('upload_failed');
        }

        const completeResponse = await fetch(`${origin}/v1/media/${intent.assetId}/complete`, {
          method: 'POST',
          headers: {
            ...nestHeaders,
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            sha256,
            unitId: input.unitId,
            position: input.position,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        });
        if (!completeResponse.ok) {
          const detail = await completeResponse.text().catch(() => '');
          console.error('Nest media complete failed', completeResponse.status, detail.slice(0, 300));
          throw new Error('upload_failed');
        }
        const completed = (await completeResponse.json()) as { assetId?: string };

        return {
          assetId: completed.assetId ?? intent.assetId,
          url: `/api/owner/media/${completed.assetId ?? intent.assetId}`,
          via: 'nest',
        };
      } catch (nestError) {
        console.error('Nest media server upload failed', nestError);
      }
    }
  }

  // Last resort: store compressed bytes inline in Neon so saves are not blocked.
  try {
    const inline = await uploadUnitMediaOnNeon(
      claims,
      { ...input, mimeType: detected },
      { allowInlineFallback: true },
    );
    return { ...inline, via: 'neon' };
  } catch (inlineError) {
    const code = inlineError instanceof Error ? inlineError.message : 'storage_unavailable';
    throw new Error(code === 'inline_too_large' ? 'inline_too_large' : 'storage_unavailable');
  }
}

export function hashIdempotencyPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
