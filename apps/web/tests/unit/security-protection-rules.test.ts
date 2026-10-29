import { describe, expect, it } from 'vitest';
import {
  buildThreatFindings,
  shouldLockAccount,
  shouldQuarantineIp,
  SECURITY_THRESHOLDS,
} from '@/lib/security-protection-rules';

describe('security-protection-rules', () => {
  it('quarantines after the IP failure threshold', () => {
    expect(shouldQuarantineIp(SECURITY_THRESHOLDS.ipFailCount - 1)).toBe(false);
    expect(shouldQuarantineIp(SECURITY_THRESHOLDS.ipFailCount)).toBe(true);
  });

  it('locks after the account failure threshold', () => {
    expect(shouldLockAccount(SECURITY_THRESHOLDS.accountFailCount - 1)).toBe(false);
    expect(shouldLockAccount(SECURITY_THRESHOLDS.accountFailCount)).toBe(true);
  });

  it('builds high severity findings for bursts and locks', () => {
    const findings = buildThreatFindings({
      ipFailures15m: SECURITY_THRESHOLDS.ipFailCount,
      accountFailures30m: SECURITY_THRESHOLDS.accountFailCount,
      activeQuarantines: 1,
      activeLocks: 2,
      multiCountryUsers24h: 0,
      revokedSessions7d: 0,
      auditAnomalies7d: 0,
    });
    expect(findings.some((row) => row.code === 'ip_failure_burst' && row.severity === 'high')).toBe(
      true,
    );
    expect(
      findings.some((row) => row.code === 'account_credential_theft' && row.severity === 'high'),
    ).toBe(true);
    expect(findings.some((row) => row.code === 'active_account_locks')).toBe(true);
  });

  it('reports a clear signal when nothing is elevated', () => {
    const findings = buildThreatFindings({
      ipFailures15m: 0,
      accountFailures30m: 0,
      activeQuarantines: 0,
      activeLocks: 0,
      multiCountryUsers24h: 0,
      revokedSessions7d: 0,
      auditAnomalies7d: 0,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('no_active_threats');
  });
});
