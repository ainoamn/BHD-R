import { describe, expect, it } from 'vitest';
import {
  ANNEX_META,
  CONTRACT_ANNEXES,
  annexReference,
  contractAnnexLinks,
  isContractAnnexKind,
} from '@/lib/contract-annex';

describe('contract annexes', () => {
  it('gives each annex a fixed number and reference under its contract', () => {
    expect(CONTRACT_ANNEXES.map((kind) => ANNEX_META[kind].number)).toEqual([1, 2, 3]);
    expect(annexReference('CTR-2026-000001', 'check-in')).toBe('CTR-2026-000001-A1');
    expect(annexReference('CTR-2026-000001', 'check-out')).toBe('CTR-2026-000001-A2');
    expect(annexReference('CTR-2026-000001', 'deposit-refund')).toBe('CTR-2026-000001-A3');
  });

  it('lists all three annexes, recorded or not, in a stable order', () => {
    const links = contractAnnexLinks('CTR-2026-000002', {
      checkIn: '2026-10-10T10:00:00.000Z',
      checkOut: null,
      depositRefund: null,
    });
    expect(links.map((link) => link.kind)).toEqual(['check-in', 'check-out', 'deposit-refund']);
    expect(links[0]).toEqual({
      kind: 'check-in',
      reference: 'CTR-2026-000002-A1',
      recordedAt: '2026-10-10T10:00:00.000Z',
    });
    expect(links[1]?.recordedAt).toBeNull();
  });

  it('accepts only known annex slugs from the URL', () => {
    expect(isContractAnnexKind('check-in')).toBe(true);
    expect(isContractAnnexKind('deposit-refund')).toBe(true);
    expect(isContractAnnexKind('handover')).toBe(false);
    expect(isContractAnnexKind(undefined)).toBe(false);
  });
});
