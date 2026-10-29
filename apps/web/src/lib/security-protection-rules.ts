/** Thresholds and pure decision helpers for platform auth abuse controls. */

export const SECURITY_THRESHOLDS = {
  /** Failures from one IP within the window → temporary quarantine. */
  ipFailCount: 8,
  ipFailWindowMs: 15 * 60_000,
  ipQuarantineMs: 2 * 60 * 60_000,
  /** Failures targeting one account (email) within the window → lock. */
  accountFailCount: 6,
  accountFailWindowMs: 30 * 60_000,
  /** Distinct countries for one user in a short window → threat signal. */
  multiCountrySessionWarn: 3,
  multiCountryWindowMs: 24 * 60 * 60_000,
} as const;

export type AuthAttemptOutcome = 'success' | 'failure' | 'blocked' | 'quarantined' | 'locked';

export function shouldQuarantineIp(failureCountInWindow: number): boolean {
  return failureCountInWindow >= SECURITY_THRESHOLDS.ipFailCount;
}

export function shouldLockAccount(failureCountInWindow: number): boolean {
  return failureCountInWindow >= SECURITY_THRESHOLDS.accountFailCount;
}

export type ThreatFinding = {
  id: string;
  severity: 'info' | 'warn' | 'high';
  code: string;
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  count?: number;
};

/** Heuristic “scan” over aggregated counters (no ML dependency). */
export function buildThreatFindings(input: {
  ipFailures15m: number;
  accountFailures30m: number;
  activeQuarantines: number;
  activeLocks: number;
  multiCountryUsers24h: number;
  revokedSessions7d: number;
  auditAnomalies7d: number;
}): ThreatFinding[] {
  const findings: ThreatFinding[] = [];

  if (input.ipFailures15m >= SECURITY_THRESHOLDS.ipFailCount) {
    findings.push({
      id: 'ip_burst',
      severity: 'high',
      code: 'ip_failure_burst',
      titleAr: 'اندفاع فشل من عناوين IP',
      titleEn: 'IP failure burst',
      detailAr: `رُصدت ${input.ipFailures15m} محاولة فاشلة خلال 15 دقيقة — يُفضّل الحجر التلقائي.`,
      detailEn: `${input.ipFailures15m} failures in 15 minutes — auto-quarantine should apply.`,
      count: input.ipFailures15m,
    });
  } else if (input.ipFailures15m >= 3) {
    findings.push({
      id: 'ip_elevated',
      severity: 'warn',
      code: 'ip_failure_elevated',
      titleAr: 'محاولات فاشلة مرتفعة',
      titleEn: 'Elevated failed attempts',
      detailAr: `${input.ipFailures15m} فشلاً خلال 15 دقيقة.`,
      detailEn: `${input.ipFailures15m} failures in the last 15 minutes.`,
      count: input.ipFailures15m,
    });
  }

  if (input.accountFailures30m >= SECURITY_THRESHOLDS.accountFailCount) {
    findings.push({
      id: 'account_theft',
      severity: 'high',
      code: 'account_credential_theft',
      titleAr: 'اشتباه سرقة حساب',
      titleEn: 'Suspected account takeover',
      detailAr: `${input.accountFailures30m} فشلاً موجّهاً لحسابات خلال 30 دقيقة.`,
      detailEn: `${input.accountFailures30m} account-targeted failures in 30 minutes.`,
      count: input.accountFailures30m,
    });
  }

  if (input.activeQuarantines > 0) {
    findings.push({
      id: 'quarantines',
      severity: 'warn',
      code: 'active_ip_quarantines',
      titleAr: 'حجر عناوين نشط',
      titleEn: 'Active IP quarantines',
      detailAr: `${input.activeQuarantines} عنواناً محجوراً حالياً.`,
      detailEn: `${input.activeQuarantines} IP(s) currently quarantined.`,
      count: input.activeQuarantines,
    });
  }

  if (input.activeLocks > 0) {
    findings.push({
      id: 'locks',
      severity: 'high',
      code: 'active_account_locks',
      titleAr: 'حسابات مقفلة أمنياً',
      titleEn: 'Security-locked accounts',
      detailAr: `${input.activeLocks} حساباً بانتظار الاستعادة الآمنة.`,
      detailEn: `${input.activeLocks} account(s) awaiting secure recovery.`,
      count: input.activeLocks,
    });
  }

  if (input.multiCountryUsers24h >= SECURITY_THRESHOLDS.multiCountrySessionWarn) {
    findings.push({
      id: 'geo_spread',
      severity: 'warn',
      code: 'multi_country_sessions',
      titleAr: 'جلسات من دول متعددة',
      titleEn: 'Multi-country sessions',
      detailAr: `${input.multiCountryUsers24h} مستخدماً ظهروا من ≥3 دول خلال 24 ساعة.`,
      detailEn: `${input.multiCountryUsers24h} user(s) seen from ≥3 countries in 24h.`,
      count: input.multiCountryUsers24h,
    });
  }

  if (input.auditAnomalies7d > 20) {
    findings.push({
      id: 'audit_spike',
      severity: 'info',
      code: 'audit_volume_spike',
      titleAr: 'ارتفاع حجم التدقيق',
      titleEn: 'Audit volume spike',
      detailAr: `${input.auditAnomalies7d} حدثاً حساساً خلال 7 أيام.`,
      detailEn: `${input.auditAnomalies7d} sensitive audit events in 7 days.`,
      count: input.auditAnomalies7d,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: 'clear',
      severity: 'info',
      code: 'no_active_threats',
      titleAr: 'لا توجد إشارات حرجة',
      titleEn: 'No critical signals',
      detailAr: 'الفحص الآلي لم يجد عتبات تجاوزت الحدود الآن.',
      detailEn: 'Heuristic scan found no threshold breaches right now.',
    });
  }

  return findings;
}

export function normalizePhoneDigits(value: string): string {
  return value.replace(/\D+/g, '').slice(0, 20);
}

export function normalizeCivilId(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase().slice(0, 40);
}
