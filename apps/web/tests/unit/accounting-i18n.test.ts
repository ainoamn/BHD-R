import { describe, expect, it } from 'vitest';
import {
  accountingDisplayText,
  accountingJournalStatusLabel,
  accountingSourceTypeLabel,
} from '@/lib/accounting-i18n';

describe('accounting i18n', () => {
  it('localizes journal status and source by locale', () => {
    expect(accountingJournalStatusLabel('posted', 'ar')).toBe('مرحّل');
    expect(accountingJournalStatusLabel('posted', 'en')).toBe('Posted');
    expect(accountingJournalStatusLabel('reversed', 'ar')).toBe('معكوس');
    expect(accountingSourceTypeLabel('reservation_deposit', 'ar')).toBe('عربون حجز');
    expect(accountingSourceTypeLabel('stay_payment', 'en')).toBe('Stay payment');
  });

  it('localizes stored descriptions when switching language', () => {
    expect(accountingDisplayText('Reversal of REV-2026-000001', 'ar')).toBe(
      'عكس القيد REV-2026-000001',
    );
    expect(accountingDisplayText('عكس القيد REV-2026-000001', 'en')).toBe(
      'Reversal of REV-2026-000001',
    );
    expect(accountingDisplayText('عربون حجز محتجز ABC', 'en')).toContain('Booking deposit');
    expect(accountingDisplayText('reservation_deposit', 'ar')).toBe('عربون حجز');
  });
});
