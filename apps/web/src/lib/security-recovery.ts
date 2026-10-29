import 'server-only';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { securityIdentityFingerprints, securityRecoveryChallenges } from '@bhd-r/db';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { emailableAddress, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { normalizeEmailInput } from '@/lib/email-address';
import {
  hashEmailForSecurity,
  hashSecurityValue,
  unlockUserAccount,
} from '@/lib/security-protection';
import { normalizeCivilId, normalizePhoneDigits } from '@/lib/security-protection-rules';

const OTP_TTL_MS = 15 * 60_000;
const CHALLENGE_TTL_MS = 60 * 60_000;
const MAX_ATTEMPTS = 8;

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function partyCivilHash(organizationId: string, civilId: string): string {
  const pepper =
    process.env.PII_LOOKUP_PEPPER?.trim() ||
    process.env.BHD_R_SESSION_SECRET?.trim() ||
    'bhd-r-dev-security-pepper';
  const normalized = normalizeCivilId(civilId);
  return createHmac('sha256', pepper)
    .update(`${organizationId}\0civil_id\0${normalized}`)
    .digest('hex');
}

function otpHash(challengeId: string, channel: 'email' | 'whatsapp', code: string): string {
  return hashSecurityValue(`recovery-otp:${channel}`, `${challengeId}\0${code}`);
}

function whatsappEnabled(): boolean {
  return process.env.WHATSAPP_OTP_ENABLED === '1' || process.env.WHATSAPP_OTP_ENABLED === 'true';
}

async function verifyLastTransaction(userId: string, lastTxn: string): Promise<boolean> {
  const needle = lastTxn.trim().toLowerCase().slice(0, 80);
  if (!needle) return false;
  return elevatedTx(async (tx) => {
    const [byRef] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select true as ok
        from stay_bookings b
        join memberships m on m.organization_id = b.organization_id
        where m.user_id = ${userId}::uuid
          and lower(b.reference_code) = ${needle}
          and b.created_at > now() - interval '365 days'
        limit 1
      `),
    );
    if (byRef?.ok) return true;

    const amount = needle.replace(/[^\d.]/g, '');
    if (!amount) return false;
    const [byAmount] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select true as ok
        from stay_bookings b
        join memberships m on m.organization_id = b.organization_id
        where m.user_id = ${userId}::uuid
          and (
            b.total_minor::text = ${amount.replace('.', '')}
            or b.reference_code ilike ${'%' + needle.slice(0, 24) + '%'}
          )
          and b.created_at > now() - interval '365 days'
        limit 1
      `),
    );
    return Boolean(byAmount?.ok);
  });
}

async function verifyCivilAgainstParties(userId: string, civilId: string): Promise<boolean> {
  return elevatedTx(async (tx) => {
    const orgs = rowsOf<{ organization_id: string; national_id_lookup_hash: string | null }>(
      await tx.execute(sql`
        select m.organization_id, p.national_id_lookup_hash
        from memberships m
        left join parties p on p.id = m.party_id
        where m.user_id = ${userId}::uuid
          and m.status = 'active'
      `),
    );
    for (const row of orgs) {
      if (!row.national_id_lookup_hash) continue;
      if (partyCivilHash(row.organization_id, civilId) === row.national_id_lookup_hash) {
        return true;
      }
    }
    // No party civil on file — accept civil for fingerprint enrollment after other checks.
    return orgs.every((row) => !row.national_id_lookup_hash);
  });
}

async function verifyWhatsappAgainstParty(userId: string, whatsapp: string): Promise<boolean> {
  const digits = normalizePhoneDigits(whatsapp);
  if (digits.length < 8) return false;
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select true as ok
        from memberships m
        join parties p on p.id = m.party_id
        where m.user_id = ${userId}::uuid
          and m.status = 'active'
          and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like ${'%' + digits.slice(-8)}
        limit 1
      `),
    );
    if (row?.ok) return true;
    const [anyPhone] = rowsOf<{ n: string }>(
      await tx.execute(sql`
        select count(*)::text as n
        from memberships m
        join parties p on p.id = m.party_id
        where m.user_id = ${userId}::uuid
          and m.status = 'active'
          and coalesce(p.phone, '') <> ''
      `),
    );
    // No stored phone → allow enrollment of the provided WhatsApp after OTP.
    return Number(anyPhone?.n ?? 0) === 0;
  });
}

/**
 * Start locked-account recovery: verify owner facts, send email OTP
 * (WhatsApp OTP when WHATSAPP_OTP_ENABLED).
 */
export async function startSecurityUnlock(input: {
  email: string;
  civilId: string;
  dateOfBirth: string;
  idExpiry: string;
  whatsapp: string;
  lastTransaction: string;
  locale: 'ar' | 'en';
}): Promise<{
  challengeId: string;
  expiresAt: string;
  whatsappChannel: 'deferred' | 'sent' | 'skipped';
  passwordResetHint: boolean;
}> {
  const email = emailableAddress(input.email);
  if (!email) fail('invalid_email');

  const user = await elevatedTx(async (tx) => {
    const [row] = rowsOf<{ id: string; email: string; security_locked_at: Date | null }>(
      await tx.execute(sql`
        select id, email, security_locked_at
        from users
        where lower(email) = ${normalizeEmailInput(email)}
        limit 1
      `),
    );
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      securityLockedAt: row.security_locked_at,
    };
  });

  if (!user?.securityLockedAt) fail('not_locked');

  const civilOk = await verifyCivilAgainstParties(user.id, input.civilId);
  if (!civilOk) fail('identity_mismatch');

  const txnOk = await verifyLastTransaction(user.id, input.lastTransaction);
  if (!txnOk) fail('transaction_mismatch');

  const phoneOk = await verifyWhatsappAgainstParty(user.id, input.whatsapp);
  if (!phoneOk) fail('whatsapp_mismatch');

  const fingerprints = await elevatedTx(async (tx) => {
    const [row] = await tx
      .select()
      .from(securityIdentityFingerprints)
      .where(eq(securityIdentityFingerprints.userId, user.id));
    return row ?? null;
  });

  const civilHash = hashSecurityValue('civil', normalizeCivilId(input.civilId));
  const dobHash = hashSecurityValue('dob', input.dateOfBirth.trim());
  const expiryHash = hashSecurityValue('id_expiry', input.idExpiry.trim());
  const whatsappHash = hashSecurityValue('whatsapp', normalizePhoneDigits(input.whatsapp));
  const lastTxnHash = hashSecurityValue('last_txn', input.lastTransaction.trim().toLowerCase());
  const emailHash = hashEmailForSecurity(email);

  if (fingerprints) {
    if (fingerprints.civilIdHash && fingerprints.civilIdHash !== civilHash)
      fail('identity_mismatch');
    if (fingerprints.dobHash && fingerprints.dobHash !== dobHash) fail('identity_mismatch');
    if (fingerprints.idExpiryHash && fingerprints.idExpiryHash !== expiryHash) {
      fail('identity_mismatch');
    }
    if (fingerprints.whatsappHash && fingerprints.whatsappHash !== whatsappHash) {
      fail('whatsapp_mismatch');
    }
  }

  const lockId = await elevatedTx(async (tx) => {
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        select id from security_account_locks
        where user_id = ${user.id}::uuid and unlocked_at is null
        order by locked_at desc
        limit 1
      `),
    );
    return row?.id ?? null;
  });

  const emailCode = String(randomInt(100_000, 999_999));
  const whatsappCode = String(randomInt(100_000, 999_999));
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const otpExpires = new Date(Date.now() + OTP_TTL_MS);
  const channel = whatsappEnabled() ? 'sent' : 'deferred';

  const challengeId = await elevatedTx(async (tx) => {
    const id = randomUUID();
    await tx.insert(securityRecoveryChallenges).values({
      id,
      userId: user.id,
      lockId,
      status: 'otp_sent',
      emailHash,
      civilIdHash: civilHash,
      dobHash,
      idExpiryHash: expiryHash,
      whatsappHash,
      lastTxnHash,
      emailOtpHash: otpHash(id, 'email', emailCode),
      whatsappOtpHash: channel === 'sent' ? otpHash(id, 'whatsapp', whatsappCode) : null,
      emailOtpExpiresAt: otpExpires,
      whatsappOtpExpiresAt: channel === 'sent' ? otpExpires : null,
      whatsappChannel: channel,
      expiresAt,
      metadata: { locale: input.locale },
    });

    await queueBrandedEmail(tx, {
      orgId: null,
      recipient: email,
      subject:
        input.locale === 'ar'
          ? 'رمز التحقق لاستعادة حسابك — BHD R'
          : 'Your BHD R account recovery code',
      aggregateType: 'security_unlock',
      aggregateId: id,
      dedupeKey: `security-unlock:${id}`,
      tone: 'alert',
      warmClosing: false,
      title: input.locale === 'ar' ? 'استعادة الحساب المقفول' : 'Unlock your secured account',
      intro:
        input.locale === 'ar'
          ? `رمز التحقق بالبريد هو ${emailCode}. ينتهي خلال 15 دقيقة.`
          : `Your email verification code is ${emailCode}. It expires in 15 minutes.`,
      lines:
        input.locale === 'ar'
          ? [
              'أدخل الرمز في صفحة استعادة الحماية. لا تشاركه مع أحد.',
              channel === 'deferred'
                ? 'قناة واتساب غير مفعّلة بعد؛ يكفي رمز البريد حالياً.'
                : 'سيصلك رمز واتساب منفصل إن كانت القناة مفعّلة.',
            ]
          : [
              'Enter the code on the security unlock page. Do not share it.',
              channel === 'deferred'
                ? 'WhatsApp is not enabled yet; the email code alone is enough for now.'
                : 'A separate WhatsApp code is sent when that channel is enabled.',
            ],
      details: [{ label: input.locale === 'ar' ? 'الرمز' : 'Code', value: emailCode }],
      footnote:
        input.locale === 'ar'
          ? 'بعد التحقق يمكنك إعادة تعيين كلمة المرور عبر استعادة كلمة المرور.'
          : 'After verification you can reset your password via password recovery.',
    });

    return id;
  });

  void sendQueuedEmailsSoon();

  if (channel === 'sent') {
    // Placeholder until WhatsApp provider is wired; code is stored hashed only.
    console.info('[security-recovery] whatsapp otp queued', {
      challengeId,
      toHash: whatsappHash.slice(0, 8),
    });
  }

  return {
    challengeId,
    expiresAt: expiresAt.toISOString(),
    whatsappChannel: channel,
    passwordResetHint: true,
  };
}

export async function verifySecurityUnlock(input: {
  challengeId: string;
  emailOtp: string;
  whatsappOtp?: string;
}): Promise<{ unlocked: true; passwordResetPath: string }> {
  if (!/^\d{6}$/.test(input.emailOtp)) fail('invalid_otp');

  const challenge = await elevatedTx(async (tx) => {
    const [row] = await tx
      .select()
      .from(securityRecoveryChallenges)
      .where(eq(securityRecoveryChallenges.id, input.challengeId));
    return row ?? null;
  });

  if (!challenge) fail('otp_not_found');
  if (challenge.consumedAt || challenge.status === 'consumed') fail('otp_used');
  if (challenge.expiresAt.getTime() < Date.now()) fail('otp_expired');
  if (challenge.attempts >= MAX_ATTEMPTS) fail('otp_locked');

  await elevatedTx(async (tx) => {
    await tx.execute(sql`
      update security_recovery_challenges
      set attempts = attempts + 1, updated_at = now()
      where id = ${challenge.id}::uuid
    `);
  });

  if (
    !challenge.emailOtpHash ||
    !challenge.emailOtpExpiresAt ||
    challenge.emailOtpExpiresAt.getTime() < Date.now()
  ) {
    fail('otp_expired');
  }
  if (otpHash(challenge.id, 'email', input.emailOtp) !== challenge.emailOtpHash) {
    fail('otp_invalid');
  }

  if (challenge.whatsappChannel === 'sent') {
    if (!input.whatsappOtp || !/^\d{6}$/.test(input.whatsappOtp)) fail('whatsapp_otp_required');
    if (
      !challenge.whatsappOtpHash ||
      !challenge.whatsappOtpExpiresAt ||
      challenge.whatsappOtpExpiresAt.getTime() < Date.now()
    ) {
      fail('otp_expired');
    }
    if (otpHash(challenge.id, 'whatsapp', input.whatsappOtp) !== challenge.whatsappOtpHash) {
      fail('otp_invalid');
    }
  }

  await elevatedTx(async (tx) => {
    await tx
      .insert(securityIdentityFingerprints)
      .values({
        userId: challenge.userId,
        civilIdHash: challenge.civilIdHash,
        dobHash: challenge.dobHash,
        idExpiryHash: challenge.idExpiryHash,
        whatsappHash: challenge.whatsappHash,
        emailHash: challenge.emailHash,
      })
      .onConflictDoUpdate({
        target: securityIdentityFingerprints.userId,
        set: {
          civilIdHash: challenge.civilIdHash,
          dobHash: challenge.dobHash,
          idExpiryHash: challenge.idExpiryHash,
          whatsappHash: challenge.whatsappHash,
          emailHash: challenge.emailHash,
          updatedAt: new Date(),
        },
      });

    await tx.execute(sql`
      update security_recovery_challenges
      set status = 'consumed',
          consumed_at = now(),
          email_verified_at = now(),
          whatsapp_verified_at = case
            when whatsapp_channel = 'sent' then now()
            else whatsapp_verified_at
          end,
          updated_at = now()
      where id = ${challenge.id}::uuid
    `);
  });

  await unlockUserAccount({
    userId: challenge.userId,
    unlockedBy: 'recovery_otp',
    lockId: challenge.lockId,
  });

  return { unlocked: true, passwordResetPath: '/forgot-password' };
}
