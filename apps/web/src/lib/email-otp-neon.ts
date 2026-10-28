import 'server-only';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { outboxEvents } from '@bhd-r/db';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { emailableAddress, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { normalizeEmailInput } from '@/lib/email-address';

const PURPOSE = 'email_otp';
const TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

function emailHash(email: string): string {
  return createHash('sha256')
    .update(`email-otp\0${normalizeEmailInput(email)}`)
    .digest('hex');
}

function codeHash(email: string, code: string): string {
  return createHash('sha256')
    .update(`email-otp-code\0${normalizeEmailInput(email)}\0${code}`)
    .digest('hex');
}

/** Deterministic UUID v5-like from email hash for aggregate id. */
function challengeId(email: string): string {
  const h = emailHash(email);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

/**
 * Sends a 6-digit OTP to verify a tenant/company email during booking.
 * Challenges live in outbox_events (no schema migration).
 */
export async function sendEmailOtp(input: {
  email: string;
  locale: 'ar' | 'en';
  organizationId?: string | null;
}): Promise<{ ok: true; expiresAt: string }> {
  const email = emailableAddress(input.email);
  if (!email) fail('invalid_email');

  const code = String(randomInt(100_000, 999_999));
  const expiresAt = new Date(Date.now() + TTL_MS);
  const aggregateId = challengeId(email);
  const hash = codeHash(email, code);

  await elevatedTx(async (tx) => {
    // Mark prior challenges used.
    await tx.execute(sql`
      update outbox_events
      set published_at = coalesce(published_at, now()),
          payload = payload || '{"consumed":true}'::jsonb
      where aggregate_type = ${PURPOSE}
        and aggregate_id = ${aggregateId}::uuid
        and published_at is null
    `);

    await queueBrandedEmail(tx, {
      orgId: input.organizationId ?? null,
      recipient: email,
      subject:
        input.locale === 'ar'
          ? `رمز التحقق من البريد — ${code}`
          : `Email verification code — ${code}`,
      aggregateType: PURPOSE,
      aggregateId,
      dedupeKey: `email-otp-send:${aggregateId}:${expiresAt.toISOString()}`,
      tone: 'booking',
      title: input.locale === 'ar' ? 'رمز التحقق من بريدك' : 'Verify your email',
      intro:
        input.locale === 'ar'
          ? `رمز التحقق الخاص بك هو ${code}. صالح لمدة 15 دقيقة.`
          : `Your verification code is ${code}. It expires in 15 minutes.`,
      lines:
        input.locale === 'ar'
          ? ['لا تشارك هذا الرمز مع أحد.', '— English —', 'Do not share this code with anyone.']
          : ['Do not share this code with anyone.', '— العربية —', 'لا تشارك هذا الرمز مع أحد.'],
      details: [
        { label: input.locale === 'ar' ? 'الرمز' : 'Code', value: code },
        {
          label: input.locale === 'ar' ? 'ينتهي' : 'Expires',
          value: expiresAt.toISOString().slice(0, 16).replace('T', ' '),
        },
      ],
    });

    await tx.insert(outboxEvents).values({
      organizationId: input.organizationId ?? null,
      topic: 'email.otp.challenge',
      aggregateType: PURPOSE,
      aggregateId,
      payload: {
        emailHash: emailHash(email),
        codeHash: hash,
        expiresAt: expiresAt.toISOString(),
        attempts: 0,
        consumed: false,
        locale: input.locale,
        correlationId: randomUUID(),
      },
      publishedAt: null,
    });
  });

  sendQueuedEmailsSoon();
  return { ok: true, expiresAt: expiresAt.toISOString() };
}

export async function verifyEmailOtp(input: {
  email: string;
  code: string;
}): Promise<{ ok: true; email: string }> {
  const email = emailableAddress(input.email);
  if (!email) fail('invalid_email');
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) fail('invalid_otp');

  const aggregateId = challengeId(email);
  const expected = codeHash(email, code);

  await elevatedTx(async (tx) => {
    const rows = rowsOf<{
      id: string;
      payload: {
        codeHash?: string;
        expiresAt?: string;
        attempts?: number;
        consumed?: boolean;
      };
    }>(
      await tx.execute(sql`
        select id, payload
        from outbox_events
        where aggregate_type = ${PURPOSE}
          and aggregate_id = ${aggregateId}::uuid
          and topic = 'email.otp.challenge'
          and published_at is null
        order by occurred_at desc
        limit 1
      `),
    );
    const row = rows[0];
    if (!row) fail('otp_not_found');
    const payload = row.payload ?? {};
    if (payload.consumed) fail('otp_used');
    if (!payload.expiresAt || new Date(payload.expiresAt).getTime() < Date.now()) {
      fail('otp_expired');
    }
    const attempts = Number(payload.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) fail('otp_locked');
    if (payload.codeHash !== expected) {
      await tx.execute(sql`
        update outbox_events
        set payload = jsonb_set(payload, '{attempts}', to_jsonb(${attempts + 1}))
        where id = ${row.id}::uuid
      `);
      fail('otp_invalid');
    }
    await tx.execute(sql`
      update outbox_events
      set published_at = now(),
          payload = payload || '{"consumed":true,"verified":true}'::jsonb
      where id = ${row.id}::uuid
    `);
  });

  return { ok: true, email };
}
