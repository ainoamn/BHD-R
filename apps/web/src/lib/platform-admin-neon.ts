import 'server-only';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { hasPermission } from '@bhd-r/authz';
import { elevatedTx, isoOf, rowsOf } from '@/lib/elevated-db';
import { siteAdminAccess } from '@/lib/site-admin-neon';
import {
  DEFAULT_PLANS,
  SUBSCRIPTION_STATUSES,
  type PlanDefinition,
  type SubscriptionStatus,
} from '@/lib/site-admin-shared';

function fail(code: string): never {
  throw new Error(code);
}

function canPlatform(claims: SessionClaims): boolean {
  return (
    hasPermission(claims, 'platform.settings.read') ||
    hasPermission(claims, 'platform.audit.read') ||
    hasPermission(claims, 'platform.settings.write')
  );
}

/** Site console (owners/managers) or classic platform_admin permissions. */
async function assertSiteConsole(claims: SessionClaims): Promise<void> {
  if (canPlatform(claims)) return;
  const access = await siteAdminAccess(claims).catch(() => null);
  if (access) return;
  fail('forbidden');
}

function envConfigured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export type DiagnosticCheck = {
  id: string;
  labelAr: string;
  labelEn: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detailAr: string;
  detailEn: string;
};

export type PlatformDiagnostics = {
  generatedAt: string;
  checks: DiagnosticCheck[];
  counts: {
    organizations: number;
    users: number;
    activeSessions: number;
    properties: number;
    openOutbox: number;
    auditLast24h: number;
  };
};

export type PlatformBillingStats = {
  generatedAt: string;
  plans: Array<{
    key: string;
    nameAr: string;
    nameEn: string;
    price: string;
    period: 'month' | 'year';
    organizations: number;
    estimatedMonthlyMinor: string;
  }>;
  byStatus: Record<SubscriptionStatus, number>;
  totals: {
    organizations: number;
    estimatedMonthlyOmr: string;
    pastDue: number;
    suspended: number;
    trial: number;
  };
};

export type SecurityAuditRow = {
  id: string;
  at: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  organizationId: string | null;
  ipHash: string | null;
  requestId: string | null;
};

export type SecuritySessionRow = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  countryCode: string | null;
  ipHash: string | null;
  createdAt: string;
  expiresAt: string;
};

export type SecurityAttemptRow = {
  id: string;
  at: string;
  outcome: string;
  source: string;
  ipAddress: string | null;
  ipHash: string;
  countryCode: string | null;
  emailHash: string | null;
  userId: string | null;
  reason: string | null;
};

export type SecurityQuarantineRow = {
  id: string;
  ipAddress: string | null;
  ipHash: string;
  countryCode: string | null;
  reason: string;
  untilAt: string;
  createdAt: string;
};

export type SecurityLockRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  reason: string;
  lockedAt: string;
};

export type PlatformSecurityView = {
  generatedAt: string;
  sessions: { active: number; revokedLast7d: number };
  audit: SecurityAuditRow[];
  topActions: Array<{ action: string; count: number }>;
  liveSessions: SecuritySessionRow[];
  countries: Array<{ countryCode: string; sessions: number; users: number }>;
  attempts: SecurityAttemptRow[];
  quarantines: SecurityQuarantineRow[];
  locks: SecurityLockRow[];
  threats: Array<{
    id: string;
    severity: 'info' | 'warn' | 'high';
    code: string;
    titleAr: string;
    titleEn: string;
    detailAr: string;
    detailEn: string;
    count?: number;
  }>;
  thresholds: {
    ipFailCount: number;
    ipQuarantineHours: number;
    accountFailCount: number;
  };
  docsPath: string;
  noteAr: string;
  noteEn: string;
};

async function loadPlanCatalog(): Promise<PlanDefinition[]> {
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ value: unknown }>(
      await tx.execute(sql`select value from platform_settings where key = 'plan_catalog' limit 1`),
    );
    const list = (row?.value as { plans?: unknown } | null)?.plans;
    if (!Array.isArray(list) || !list.length) return DEFAULT_PLANS;
    return list as PlanDefinition[];
  });
}

async function loadSubscriptions(): Promise<
  Record<string, { planKey?: string; status?: string; endsOn?: string | null }>
> {
  return elevatedTx(async (tx) => {
    const [row] = rowsOf<{ value: unknown }>(
      await tx.execute(
        sql`select value from platform_settings where key = 'organization_subscriptions' limit 1`,
      ),
    );
    const value = row?.value;
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, { planKey?: string; status?: string; endsOn?: string | null }>;
  });
}

/** Cross-cutting health for the site-admin diagnostics console. */
export async function loadPlatformDiagnostics(claims: SessionClaims): Promise<PlatformDiagnostics> {
  await assertSiteConsole(claims);
  const generatedAt = new Date().toISOString();
  const counts = await elevatedTx(async (tx) => {
    const [orgs] = rowsOf<{ n: string }>(
      await tx.execute(sql`select count(*)::text as n from organizations`),
    );
    const [userRows] = rowsOf<{ n: string }>(
      await tx.execute(sql`select count(*)::text as n from users`),
    );
    const [sessions] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from sessions where revoked_at is null and expires_at > now()`,
      ),
    );
    const [props] = rowsOf<{ n: string }>(
      await tx.execute(sql`select count(*)::text as n from properties`),
    );
    const [outbox] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from outbox_events where published_at is null`,
      ),
    );
    const [audit] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from audit_logs where occurred_at > now() - interval '24 hours'`,
      ),
    );
    return {
      organizations: Number(orgs?.n ?? 0),
      users: Number(userRows?.n ?? 0),
      activeSessions: Number(sessions?.n ?? 0),
      properties: Number(props?.n ?? 0),
      openOutbox: Number(outbox?.n ?? 0),
      auditLast24h: Number(audit?.n ?? 0),
    };
  });

  const checks: DiagnosticCheck[] = [
    {
      id: 'database',
      labelAr: 'قاعدة البيانات',
      labelEn: 'Database',
      status: 'ok',
      detailAr: `متصلة · ${counts.organizations} منشأة · ${counts.users} مستخدم`,
      detailEn: `Connected · ${counts.organizations} orgs · ${counts.users} users`,
    },
    {
      id: 'identity',
      labelAr: 'هوية BHD (OIDC)',
      labelEn: 'BHD Identity (OIDC)',
      status:
        envConfigured('BHD_IDENTITY_ISSUER') && envConfigured('BHD_IDENTITY_CLIENT_ID')
          ? 'ok'
          : 'fail',
      detailAr:
        envConfigured('BHD_IDENTITY_ISSUER') && envConfigured('BHD_IDENTITY_CLIENT_ID')
          ? 'مُعدّة'
          : 'ناقصة — راجع BHD_IDENTITY_*',
      detailEn:
        envConfigured('BHD_IDENTITY_ISSUER') && envConfigured('BHD_IDENTITY_CLIENT_ID')
          ? 'Configured'
          : 'Incomplete — check BHD_IDENTITY_*',
    },
    {
      id: 'storage',
      labelAr: 'التخزين الخاص',
      labelEn: 'Private object storage',
      status: envConfigured('S3_BUCKET_PRIVATE') && envConfigured('S3_ACCESS_KEY') ? 'ok' : 'warn',
      detailAr:
        envConfigured('S3_BUCKET_PRIVATE') && envConfigured('S3_ACCESS_KEY')
          ? 'مُعدّ'
          : 'غير مكتمل — المرفقات قد تفشل',
      detailEn:
        envConfigured('S3_BUCKET_PRIVATE') && envConfigured('S3_ACCESS_KEY')
          ? 'Configured'
          : 'Incomplete — attachments may fail',
    },
    {
      id: 'smtp',
      labelAr: 'البريد',
      labelEn: 'Transactional email',
      status: envConfigured('SMTP_HOST') ? 'ok' : 'warn',
      detailAr: envConfigured('SMTP_HOST') ? 'SMTP جاهز' : 'SMTP غير مُعدّ',
      detailEn: envConfigured('SMTP_HOST') ? 'SMTP ready' : 'SMTP not configured',
    },
    {
      id: 'payments',
      labelAr: 'توقيع webhooks الدفع',
      labelEn: 'Payment webhook signing',
      status: envConfigured('PAYMENT_WEBHOOK_SECRET') ? 'ok' : 'warn',
      detailAr: envConfigured('PAYMENT_WEBHOOK_SECRET') ? 'مُفعّل' : 'اختياري في بيئة التجربة',
      detailEn: envConfigured('PAYMENT_WEBHOOK_SECRET')
        ? 'Enabled'
        : 'Optional in sandbox environments',
    },
    {
      id: 'encryption',
      labelAr: 'تشفير الحقول الحساسة',
      labelEn: 'Field encryption',
      status:
        envConfigured('FIELD_ENCRYPTION_ACTIVE_VERSION') &&
        Object.keys(process.env).some((key) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key))
          ? 'ok'
          : 'warn',
      detailAr: 'مفتاح التشفير النشط',
      detailEn: 'Active encryption keyring',
    },
    {
      id: 'outbox',
      labelAr: 'طابور الأحداث (outbox)',
      labelEn: 'Event outbox',
      status: counts.openOutbox > 2000 ? 'fail' : counts.openOutbox > 200 ? 'warn' : 'ok',
      detailAr: `${counts.openOutbox} حدث بانتظار النشر`,
      detailEn: `${counts.openOutbox} events awaiting publish`,
    },
    {
      id: 'sessions',
      labelAr: 'الجلسات النشطة',
      labelEn: 'Active sessions',
      status: 'info',
      detailAr: `${counts.activeSessions} جلسة سارية`,
      detailEn: `${counts.activeSessions} live sessions`,
    },
    {
      id: 'audit',
      labelAr: 'نشاط التدقيق (24 ساعة)',
      labelEn: 'Audit activity (24h)',
      status: 'info',
      detailAr: `${counts.auditLast24h} حدث`,
      detailEn: `${counts.auditLast24h} events`,
    },
  ];

  return { generatedAt, checks, counts };
}

/** Manual SaaS subscription desk stats (prices × org counts; no automated collection yet). */
export async function loadPlatformBillingStats(
  claims: SessionClaims,
): Promise<PlatformBillingStats> {
  const access = await siteAdminAccess(claims).catch(() => null);
  const allowed =
    Boolean(access?.root) || Boolean(access?.scopes.includes('plans')) || canPlatform(claims);
  if (!allowed) fail('forbidden');

  const [plans, subscriptions, orgRows] = await Promise.all([
    loadPlanCatalog(),
    loadSubscriptions(),
    elevatedTx(async (tx) =>
      rowsOf<{ id: string; plan_key: string | null }>(
        await tx.execute(
          sql`select id, plan_key from organizations order by created_at desc limit 2000`,
        ),
      ),
    ),
  ]);

  const byStatus = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<
    SubscriptionStatus,
    number
  >;
  const planCounts = new Map<string, number>();
  for (const org of orgRows) {
    const sub = subscriptions[org.id];
    const status = (sub?.status as SubscriptionStatus | undefined) ?? 'active';
    if (byStatus[status] !== undefined) byStatus[status] += 1;
    else byStatus.active += 1;
    const planKey = sub?.planKey || org.plan_key || 'starter';
    planCounts.set(planKey, (planCounts.get(planKey) ?? 0) + 1);
  }

  const planStats = plans.map((plan) => {
    const organizations = planCounts.get(plan.key) ?? 0;
    const priceMinor = Math.round(Number(plan.price || '0') * 1000);
    const monthly =
      plan.period === 'year'
        ? Math.round((priceMinor * organizations) / 12)
        : priceMinor * organizations;
    return {
      key: plan.key,
      nameAr: plan.nameAr,
      nameEn: plan.nameEn,
      price: plan.price,
      period: plan.period,
      organizations,
      estimatedMonthlyMinor: String(monthly),
    };
  });

  const estimatedMonthly = planStats.reduce(
    (sum, row) => sum + BigInt(row.estimatedMonthlyMinor),
    0n,
  );
  const omr = (Number(estimatedMonthly) / 1000).toFixed(3);

  return {
    generatedAt: new Date().toISOString(),
    plans: planStats,
    byStatus,
    totals: {
      organizations: orgRows.length,
      estimatedMonthlyOmr: omr,
      pastDue: byStatus.past_due,
      suspended: byStatus.suspended,
      trial: byStatus.trial,
    },
  };
}

/** Security console: audit, geo/sessions, attempts, quarantine, locks, heuristic threats. */
export async function loadPlatformSecurity(claims: SessionClaims): Promise<PlatformSecurityView> {
  if (!hasPermission(claims, 'platform.audit.read')) {
    await assertSiteConsole(claims);
  }

  const { buildThreatFindings, SECURITY_THRESHOLDS } =
    await import('@/lib/security-protection-rules');

  return elevatedTx(async (tx) => {
    const tablesReady = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select to_regclass('public.security_auth_attempts') is not null as ok
      `),
    );
    const ready = Boolean(tablesReady[0]?.ok);

    const [active] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from sessions where revoked_at is null and expires_at > now()`,
      ),
    );
    const [revoked] = rowsOf<{ n: string }>(
      await tx.execute(
        sql`select count(*)::text as n from sessions
            where revoked_at is not null and revoked_at > now() - interval '7 days'`,
      ),
    );
    const audit = rowsOf<{
      id: string;
      occurred_at: Date;
      action: string;
      resource_type: string;
      resource_id: string | null;
      actor_user_id: string | null;
      organization_id: string | null;
      ip_hash: string | null;
      request_id: string | null;
    }>(
      await tx.execute(sql`
        select id, occurred_at, action, resource_type, resource_id, actor_user_id,
               organization_id, ip_hash, request_id
        from audit_logs
        order by occurred_at desc
        limit 120
      `),
    );
    const top = rowsOf<{ action: string; count: string }>(
      await tx.execute(sql`
        select action, count(*)::text as count
        from audit_logs
        where occurred_at > now() - interval '7 days'
        group by action
        order by count(*) desc
        limit 12
      `),
    );

    const liveSessions = rowsOf<{
      id: string;
      user_id: string;
      email: string;
      display_name: string;
      country_code: string | null;
      ip_hash: string | null;
      created_at: Date;
      expires_at: Date;
    }>(
      await tx.execute(sql`
        select s.id, s.user_id, u.email, u.display_name, s.country_code, s.ip_hash,
               s.created_at, s.expires_at
        from sessions s
        join users u on u.id = s.user_id
        where s.revoked_at is null and s.expires_at > now()
        order by s.created_at desc
        limit 80
      `),
    );

    const countries = rowsOf<{ country_code: string; sessions: string; users: string }>(
      await tx.execute(sql`
        select coalesce(nullif(s.country_code, ''), '??') as country_code,
               count(*)::text as sessions,
               count(distinct s.user_id)::text as users
        from sessions s
        where s.revoked_at is null and s.expires_at > now()
        group by 1
        order by count(*) desc
        limit 40
      `),
    );

    const attempts = ready
      ? rowsOf<{
          id: string;
          created_at: Date;
          outcome: string;
          source: string;
          ip_address: string | null;
          ip_hash: string;
          country_code: string | null;
          email_hash: string | null;
          user_id: string | null;
          reason: string | null;
        }>(
          await tx.execute(sql`
            select id, created_at, outcome, source, ip_address, ip_hash, country_code,
                   email_hash, user_id, reason
            from security_auth_attempts
            order by created_at desc
            limit 100
          `),
        )
      : [];

    const quarantines = ready
      ? rowsOf<{
          id: string;
          ip_address: string | null;
          ip_hash: string;
          country_code: string | null;
          reason: string;
          until_at: Date;
          created_at: Date;
        }>(
          await tx.execute(sql`
            select id, ip_address, ip_hash, country_code, reason, until_at, created_at
            from security_ip_quarantines
            where released_at is null and until_at > now()
            order by until_at desc
            limit 50
          `),
        )
      : [];

    const locks = ready
      ? rowsOf<{
          id: string;
          user_id: string;
          email: string;
          display_name: string;
          reason: string;
          locked_at: Date;
        }>(
          await tx.execute(sql`
            select l.id, l.user_id, u.email, u.display_name, l.reason, l.locked_at
            from security_account_locks l
            join users u on u.id = l.user_id
            where l.unlocked_at is null
            order by l.locked_at desc
            limit 50
          `),
        )
      : [];

    const [ipFails] = ready
      ? rowsOf<{ n: string }>(
          await tx.execute(sql`
            select count(*)::text as n from security_auth_attempts
            where outcome in ('failure', 'blocked')
              and created_at > now() - interval '15 minutes'
          `),
        )
      : [{ n: '0' }];
    const [acctFails] = ready
      ? rowsOf<{ n: string }>(
          await tx.execute(sql`
            select count(*)::text as n from security_auth_attempts
            where outcome in ('failure', 'blocked')
              and email_hash is not null
              and created_at > now() - interval '30 minutes'
          `),
        )
      : [{ n: '0' }];
    const [multiCountry] = rowsOf<{ n: string }>(
      await tx.execute(sql`
        select count(*)::text as n from (
          select user_id
          from sessions
          where created_at > now() - interval '24 hours'
            and country_code is not null
          group by user_id
          having count(distinct country_code) >= 3
        ) t
      `),
    );
    const [auditAnomalies] = rowsOf<{ n: string }>(
      await tx.execute(sql`
        select count(*)::text as n from audit_logs
        where occurred_at > now() - interval '7 days'
          and (
            action ilike 'security.%'
            or action ilike '%suspend%'
            or action ilike '%delete%'
            or action ilike '%password%'
          )
      `),
    );

    const threats = buildThreatFindings({
      ipFailures15m: Number(ipFails?.n ?? 0),
      accountFailures30m: Number(acctFails?.n ?? 0),
      activeQuarantines: quarantines.length,
      activeLocks: locks.length,
      multiCountryUsers24h: Number(multiCountry?.n ?? 0),
      revokedSessions7d: Number(revoked?.n ?? 0),
      auditAnomalies7d: Number(auditAnomalies?.n ?? 0),
    });

    return {
      generatedAt: new Date().toISOString(),
      sessions: {
        active: Number(active?.n ?? 0),
        revokedLast7d: Number(revoked?.n ?? 0),
      },
      audit: audit.map((row) => ({
        id: row.id,
        at: isoOf(row.occurred_at) ?? '',
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        actorUserId: row.actor_user_id,
        organizationId: row.organization_id,
        ipHash: row.ip_hash,
        requestId: row.request_id,
      })),
      topActions: top.map((row) => ({ action: row.action, count: Number(row.count) })),
      liveSessions: liveSessions.map((row) => ({
        sessionId: row.id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        countryCode: row.country_code,
        ipHash: row.ip_hash,
        createdAt: isoOf(row.created_at) ?? '',
        expiresAt: isoOf(row.expires_at) ?? '',
      })),
      countries: countries.map((row) => ({
        countryCode: row.country_code,
        sessions: Number(row.sessions),
        users: Number(row.users),
      })),
      attempts: attempts.map((row) => ({
        id: row.id,
        at: isoOf(row.created_at) ?? '',
        outcome: row.outcome,
        source: row.source,
        ipAddress: row.ip_address,
        ipHash: row.ip_hash,
        countryCode: row.country_code,
        emailHash: row.email_hash,
        userId: row.user_id,
        reason: row.reason,
      })),
      quarantines: quarantines.map((row) => ({
        id: row.id,
        ipAddress: row.ip_address,
        ipHash: row.ip_hash,
        countryCode: row.country_code,
        reason: row.reason,
        untilAt: isoOf(row.until_at) ?? '',
        createdAt: isoOf(row.created_at) ?? '',
      })),
      locks: locks.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        reason: row.reason,
        lockedAt: isoOf(row.locked_at) ?? '',
      })),
      threats,
      thresholds: {
        ipFailCount: SECURITY_THRESHOLDS.ipFailCount,
        ipQuarantineHours: Math.round(SECURITY_THRESHOLDS.ipQuarantineMs / 3_600_000),
        accountFailCount: SECURITY_THRESHOLDS.accountFailCount,
      },
      docsPath: '/docs/security/ANTI-FRAUD-AND-INTRUSION-AR.md',
      noteAr: ready
        ? 'لوحة الأمن: جلسات حسب الدولة، عناوين IP لمحاولات الدخول، حجر تلقائي، وقفل الحساب مع استعادة بالهوية وOTP. واتساب OTP جاهز للتفعيل لاحقاً.'
        : 'جداول الحماية غير مُرحَّلة بعد على هذه القاعدة — طبّق ترحيل 0052 ثم حدّث الصفحة.',
      noteEn: ready
        ? 'Security console: sessions by country, login-attempt IPs, auto quarantine, and account lock with identity+OTP recovery. WhatsApp OTP is wired for later enablement.'
        : 'Security tables are not migrated on this database yet — apply migration 0052 then refresh.',
    };
  });
}
