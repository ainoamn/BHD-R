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

export type PlatformSecurityView = {
  generatedAt: string;
  sessions: { active: number; revokedLast7d: number };
  audit: SecurityAuditRow[];
  topActions: Array<{ action: string; count: number }>;
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

/** Recent audit + session signals for the security console (hashed IPs only). */
export async function loadPlatformSecurity(claims: SessionClaims): Promise<PlatformSecurityView> {
  if (!hasPermission(claims, 'platform.audit.read')) {
    await assertSiteConsole(claims);
  }

  return elevatedTx(async (tx) => {
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
      noteAr:
        'تُعرض بصمات IP (hash) فقط دون العنوان الخام. حدّث قائمة الحظر وعتبات المعدل في مرحلة لاحقة.',
      noteEn:
        'Only hashed IP fingerprints are shown, never raw addresses. Ban lists and rate thresholds come in a later phase.',
    };
  });
}
