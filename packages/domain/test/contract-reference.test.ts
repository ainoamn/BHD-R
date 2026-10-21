import { describe, expect, it } from 'vitest';
import {
  formatChildContractReference,
  isChildContractReference,
  nextChildContractSequence,
  parseChildContractSequence,
} from '../src/contract-reference.js';

describe('child contract references', () => {
  it('formats the first addendum as -02 under the parent', () => {
    expect(formatChildContractReference('CTR-2026-000001', 2)).toBe('CTR-2026-000001-02');
    expect(formatChildContractReference('CTR-2026-000001', 4)).toBe('CTR-2026-000001-04');
  });

  it('parses only direct numeric suffixes', () => {
    expect(parseChildContractSequence('CTR-2026-000001-02', 'CTR-2026-000001')).toBe(2);
    expect(parseChildContractSequence('CTR-2026-000001-A1', 'CTR-2026-000001')).toBeNull();
    expect(parseChildContractSequence('CTR-2026-000002', 'CTR-2026-000001')).toBeNull();
    expect(isChildContractReference('CTR-2026-000001-03', 'CTR-2026-000001')).toBe(true);
  });

  it('allocates the next free suffix from siblings', () => {
    expect(nextChildContractSequence('CTR-2026-000001', [])).toBe(2);
    expect(
      nextChildContractSequence('CTR-2026-000001', ['CTR-2026-000001-02', 'CTR-2026-000001-A1']),
    ).toBe(3);
    expect(
      nextChildContractSequence('CTR-2026-000001', [
        'CTR-2026-000001-02',
        'CTR-2026-000001-04',
        'CTR-2026-000002',
      ]),
    ).toBe(5);
  });
});
