import { describe, expect, it } from 'vitest';
import { formatMinorUnits } from '../src/outbox.js';

describe('exact invoice money rendering', () => {
  it('formats values larger than Number.MAX_SAFE_INTEGER without floating-point loss', () => {
    expect(formatMinorUnits('900719925474099312345', 3)).toBe('900719925474099312.345');
    expect(formatMinorUnits('-1005', 3)).toBe('-1.005');
    expect(formatMinorUnits('5', 0)).toBe('5');
  });
});
