import { describe, expect, it } from 'vitest';
import { formatMoney, localizedName, toMinorUnits } from '@/lib/format';

describe('financial display helpers', () => {
  it('converts three-decimal OMR values without floating-point arithmetic', () => {
    expect(toMinorUnits('125.375', 'OMR')).toBe('125375');
  });
  it('converts two-decimal AED values', () => {
    expect(toMinorUnits('99.50', 'AED')).toBe('9950');
  });
  it('formats the stored minor amount in the requested currency', () => {
    expect(formatMoney('125375', 'OMR', 'en')).toContain('125.375');
  });
  it('uses the selected language for entity names', () => {
    expect(localizedName('ar', 'منزل', 'Home')).toBe('منزل');
    expect(localizedName('en', 'منزل', 'Home')).toBe('Home');
  });
});
