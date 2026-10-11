import { describe, expect, it } from 'vitest';
import { maskDate, maskTime, parseStampParts } from '@/components/stays/stamp-date-time-field';

const value = (date: string, time: string, period: 'am' | 'pm') => {
  const parsed = parseStampParts({ date, time, period });
  return parsed.ok ? parsed.value : parsed.reason;
};

describe('hand-typed check-in / check-out time', () => {
  it('formats bare digits and Arabic-Indic digits', () => {
    expect(maskDate('11102026')).toBe('11/10/2026');
    expect(maskDate('١١/١٠/٢٠٢٦')).toBe('11/10/2026');
    expect(maskDate('1-10-2026')).toBe('1/10/2026');
    expect(maskTime('307')).toBe('3:07');
    expect(maskTime('٠٣:٠٧')).toBe('03:07');
  });

  it('reads 1–12 with ص/م and 0/13–23 as a 24-hour clock', () => {
    expect(value('11/10/2026', '3:07', 'pm')).toBe('2026-10-11T15:07');
    expect(value('11/10/2026', '12:30', 'am')).toBe('2026-10-11T00:30');
    expect(value('11/10/2026', '12:30', 'pm')).toBe('2026-10-11T12:30');
    expect(value('11/10/2026', '15:07', 'am')).toBe('2026-10-11T15:07');
    expect(value('1/9/26', '0:05', 'pm')).toBe('2026-09-01T00:05');
  });

  it('rejects impossible dates and times', () => {
    expect(value('31/02/2026', '3:07', 'pm')).toBe('date');
    expect(value('11/13/2026', '3:07', 'pm')).toBe('date');
    expect(value('11/10/2026', '25:00', 'pm')).toBe('time');
    expect(value('11/10/2026', '3:7', 'pm')).toBe('time');
  });
});
