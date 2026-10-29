import 'server-only';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  auditLogs,
  securityAccountLocks,
  securityAuthAttempts,
  securityIpQuarantines,
  sessions,
} from '@bhd-r/db';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { clientIp } from '@/lib/route-rate-limit';
import {
  SECURITY_THRESHOLDS,
  shouldLockAccount,
  shouldQuarantineIp,
  type AuthAttemptOutcome,
} from '@/lib/security-protection-rules';

export type ClientSecurityContext = {
  ipAddress: string;
  ipHash: string;
  userAgentHash: string | null;
  countryCode: string | null;
};

function pepper(): string {
  return (
    process.env.PII_LOOKUP_PEPPER?.trim() ||
    process.env.BHD_R_SESSION_SECRET?.trim() ||
    'bhd-r-dev-security-pepper'
  );
}

export function hashSecurityValue(kind: string, value: string): string {
  return createHmac('sha256', pepper()).update(`${kind}\0${value}`).digest('hex');
}

export function hashIpAddress(ip: string): string {
  return createHash('sha256').update(`ip\0${ip}`).digest('hex');
}

export function hashUserAgent(ua: string | null | undefined): string | null {
  const trimmed = ua?.trim();
  if (!trimmed) return null;
  return createHash('sha256')
    .update(`ua\0${trimmed.slice(0, 512)}`)
    .digest('hex');
}

export function hashEmailForSecurity(email: string): string {
  return hashSecurityValue('email', email.trim().toLowerCase());
}

export function countryFromRequest(request: Request): string | null {
  const raw =
    request.headers.get('cf-ipcountry') ||
    request.headers.get('x-vercel-ip-country') ||
    request.headers.get('cloudfront-viewer-country') ||
    '';
  const code = raw.trim().toUpperCase();
  if (!code || code === 'XX' || code === 'T1' || code.length !== 2) return null;
  return code;
}

export function clientSecurityContext(request: Request): ClientSecurityContext {
  const ipAddress = clientIp(request);
  return {
    ipAddress,
    ipHash: hashIpAddress(ipAddress),
    userAgentHash: hashUserAgent(request.headers.get('user-agent')),
    countryCode: countryFromRequest(request),
  };
}

export async function isIpQuarantined(ipHash: string): Promise<{
  blocked: boolean;
  untilAt?: string;
  reason?: string;
}> {
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ until_at: Date; reason: string }>(
      await tx.execute(sql`
        select until_at, reason
        from security_ip_quarantines
        where ip_hash = ${ipHash}
          and released_at is null
          and until_at > now()
        order by until_at desc
        limit 1
      `),
    );
    if (!row) return { blocked: false };
    return {
      blocked: true,
      untilAt: row.until_at.toISOString(),
      reason: row.reason,
    };
  });
}

export async function isUserSecurityLocked(userId: string): Promise<boolean> {
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ locked: boolean }>(
      await tx.execute(sql`
        select (security_locked_at is not null) as locked
        from users
        where id = ${userId}::uuid
        limit 1
      `),
    );
    return Boolean(row?.locked);
  });
}

export async function quarantineIp(input: {
  ipAddress: string | null;
  ipHash: string;
  countryCode?: string | null;
  reason: string;
  untilAt?: Date;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; untilAt: string }> {
  const untilAt = input.untilAt ?? new Date(Date.now() + SECURITY_THRESHOLDS.ipQuarantineMs);
  return elevatedTx(async (tx) => {
    await tx.execute(sql`
      update security_ip_quarantines
      set released_at = now(), updated_at = now()
      where ip_hash = ${input.ipHash}
        and released_at is null
        and until_at > now()
    `);
    const [row] = await tx
      .insert(securityIpQuarantines)
      .values({
        ipAddress: input.ipAddress,
        ipHash: input.ipHash,
        countryCode: input.countryCode ?? null,
        reason: input.reason.slice(0, 160),
        untilAt,
        createdByUserId: input.createdByUserId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: securityIpQuarantines.id, untilAt: securityIpQuarantines.untilAt });
    await tx.insert(auditLogs).values({
      action: 'security.ip_quarantine',
      resourceType: 'security_ip_quarantine',
      resourceId: row!.id,
      requestId: randomUUID().slice(0, 80),
      ipHash: input.ipHash,
      actorUserId: input.createdByUserId ?? null,
      metadata: { reason: input.reason, untilAt: untilAt.toISOString() },
    });
    return { id: row!.id, untilAt: untilAt.toISOString() };
  });
}

export async function releaseIpQuarantine(input: {
  quarantineId: string;
  actorUserId: string;
}): Promise<void> {
  await elevatedTx(async (tx) => {
    await tx.execute(sql`
      update security_ip_quarantines
      set released_at = now(), updated_at = now()
      where id = ${input.quarantineId}::uuid
        and released_at is null
    `);
    await tx.insert(auditLogs).values({
      action: 'security.ip_quarantine_release',
      resourceType: 'security_ip_quarantine',
      resourceId: input.quarantineId,
      requestId: randomUUID().slice(0, 80),
      actorUserId: input.actorUserId,
      metadata: {},
    });
  });
}

export async function lockUserAccount(input: {
  userId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<{ lockId: string }> {
  return elevatedTx(async (tx) => {
    await tx.execute(sql`
      update users
      set security_locked_at = now(),
          session_version = session_version + 1,
          updated_at = now()
      where id = ${input.userId}::uuid
    `);
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));
    const [lock] = await tx
      .insert(securityAccountLocks)
      .values({
        userId: input.userId,
        reason: input.reason.slice(0, 160),
        metadata: input.metadata ?? {},
      })
      .returning({ id: securityAccountLocks.id });
    await tx.insert(auditLogs).values({
      action: 'security.account_lock',
      resourceType: 'user',
      resourceId: input.userId,
      requestId: randomUUID().slice(0, 80),
      metadata: { lockId: lock!.id, reason: input.reason },
    });
    return { lockId: lock!.id };
  });
}

export async function unlockUserAccount(input: {
  userId: string;
  unlockedBy: string;
  lockId?: string | null;
}): Promise<void> {
  await elevatedTx(async (tx) => {
    await tx.execute(sql`
      update users
      set security_locked_at = null,
          session_version = session_version + 1,
          updated_at = now()
      where id = ${input.userId}::uuid
    `);
    if (input.lockId) {
      await tx.execute(sql`
        update security_account_locks
        set unlocked_at = now(), unlocked_by = ${input.unlockedBy}, updated_at = now()
        where id = ${input.lockId}::uuid and unlocked_at is null
      `);
    } else {
      await tx.execute(sql`
        update security_account_locks
        set unlocked_at = now(), unlocked_by = ${input.unlockedBy}, updated_at = now()
        where user_id = ${input.userId}::uuid and unlocked_at is null
      `);
    }
    await tx.insert(auditLogs).values({
      action: 'security.account_unlock',
      resourceType: 'user',
      resourceId: input.userId,
      requestId: randomUUID().slice(0, 80),
      metadata: { unlockedBy: input.unlockedBy, lockId: input.lockId ?? null },
    });
  });
}

export async function recordAuthAttempt(input: {
  outcome: AuthAttemptOutcome;
  source?: string;
  ctx: ClientSecurityContext;
  email?: string | null;
  userId?: string | null;
  identitySubject?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ quarantined: boolean; locked: boolean }> {
  const emailHash = input.email ? hashEmailForSecurity(input.email) : null;

  await elevatedTx(async (tx) => {
    await tx.insert(securityAuthAttempts).values({
      outcome: input.outcome,
      source: (input.source ?? 'product').slice(0, 40),
      ipAddress: input.ctx.ipAddress === 'unknown' ? null : input.ctx.ipAddress.slice(0, 64),
      ipHash: input.ctx.ipHash,
      countryCode: input.ctx.countryCode,
      userAgentHash: input.ctx.userAgentHash,
      emailHash,
      userId: input.userId ?? null,
      identitySubject: input.identitySubject ?? null,
      reason: input.reason?.slice(0, 80) ?? null,
      metadata: input.metadata ?? {},
    });
  });

  let quarantined = false;
  let locked = false;

  if (input.outcome === 'failure' || input.outcome === 'blocked') {
    const counts = await elevatedTx(async (tx) => {
      const [ipRow] = rowsOf<{ n: string }>(
        await tx.execute(sql`
          select count(*)::text as n
          from security_auth_attempts
          where ip_hash = ${input.ctx.ipHash}
            and outcome in ('failure', 'blocked')
            and created_at > now() - interval '15 minutes'
        `),
      );
      const emailCount = emailHash
        ? rowsOf<{ n: string }>(
            await tx.execute(sql`
              select count(*)::text as n
              from security_auth_attempts
              where email_hash = ${emailHash}
                and outcome in ('failure', 'blocked')
                and created_at > now() - interval '30 minutes'
            `),
          )
        : [];
      return {
        ipFails: Number(ipRow?.n ?? 0),
        emailFails: Number(emailCount[0]?.n ?? 0),
      };
    });

    if (shouldQuarantineIp(counts.ipFails)) {
      await quarantineIp({
        ipAddress: input.ctx.ipAddress === 'unknown' ? null : input.ctx.ipAddress,
        ipHash: input.ctx.ipHash,
        countryCode: input.ctx.countryCode,
        reason: 'auto_ip_failure_burst',
        metadata: { ipFails: counts.ipFails },
      });
      quarantined = true;
    }

    if (emailHash && shouldLockAccount(counts.emailFails) && input.userId) {
      await lockUserAccount({
        userId: input.userId,
        reason: 'auto_credential_theft_attempts',
        metadata: { emailFails: counts.emailFails },
      });
      locked = true;
    } else if (emailHash && shouldLockAccount(counts.emailFails) && !input.userId) {
      const userId = await elevatedTx(async (tx) => {
        const [row] = rowsOf<{ id: string }>(
          await tx.execute(sql`
            select id from users
            where lower(email) = ${input.email!.trim().toLowerCase()}
            limit 1
          `),
        );
        return row?.id ?? null;
      });
      if (userId) {
        await lockUserAccount({
          userId,
          reason: 'auto_credential_theft_attempts',
          metadata: { emailFails: counts.emailFails },
        });
        locked = true;
      }
    }
  }

  return { quarantined, locked };
}

export async function assertClientAllowedToAuthenticate(
  ctx: ClientSecurityContext,
): Promise<{ ok: true } | { ok: false; code: 'ip_quarantined'; untilAt?: string }> {
  const q = await isIpQuarantined(ctx.ipHash);
  if (q.blocked) {
    return q.untilAt
      ? { ok: false, code: 'ip_quarantined', untilAt: q.untilAt }
      : { ok: false, code: 'ip_quarantined' };
  }
  return { ok: true };
}

export async function assertUserAllowedToAuthenticate(
  userId: string,
): Promise<{ ok: true } | { ok: false; code: 'account_security_locked' }> {
  if (await isUserSecurityLocked(userId)) {
    return { ok: false, code: 'account_security_locked' };
  }
  return { ok: true };
}
