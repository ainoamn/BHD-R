import { describe, expect, it } from 'vitest';
import {
  accountingAccountTypeLabel,
  accountingAgingBucketLabel,
  accountingAuditResourceLabel,
  accountingAuditStatusTransition,
  accountingDisplayText,
  accountingIntegrityGapKindLabel,
  accountingJournalStatusLabel,
  accountingSourceTypeLabel,
  accountingStatusChipLabel,
  accountingStatusTone,
} from '@/lib/accounting-i18n';
import { workflowEventLabel } from '@/lib/ui-labels';

describe('accounting i18n', () => {
  it('localizes journal status and source by locale', () => {
    expect(accountingJournalStatusLabel('posted', 'ar')).toBe('مرحّل');
    expect(accountingJournalStatusLabel('posted', 'en')).toBe('Posted');
    expect(accountingJournalStatusLabel('reversed', 'ar')).toBe('معكوس');
    expect(accountingSourceTypeLabel('reservation_deposit', 'ar')).toBe('عربون حجز');
    expect(accountingSourceTypeLabel('stay_payment', 'en')).toBe('Stay payment');
    expect(accountingSourceTypeLabel('year_close', 'ar')).toBe('إقفال السنة');
    expect(accountingSourceTypeLabel('cheque_clear_undone', 'ar')).toBe('تراجع تحصيل شيك');
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

  it('localizes integrity, audit, reports, and account types bilingually', () => {
    expect(accountingIntegrityGapKindLabel('ar_variance', 'ar')).toBe('فرق ذمم');
    expect(accountingIntegrityGapKindLabel('ar_variance', 'en')).toBe('AR variance');
    expect(accountingAuditResourceLabel('journal_entry', '68d08ef8abcd', 'ar')).toContain(
      'قيد يومية',
    );
    expect(accountingAuditResourceLabel('accounting_settings', '17762c25', 'en')).toContain(
      'Accounting settings',
    );
    expect(accountingAuditStatusTransition('draft', 'posted', 'ar')).toBe('مسودة → مرحّل');
    expect(accountingAuditStatusTransition(null, 'active', 'en')).toBe('Active');
    expect(accountingAuditStatusTransition(null, 'active', 'ar')).toBe('ساري');
    expect(accountingAccountTypeLabel('liability', 'ar')).toBe('التزام');
    expect(accountingAccountTypeLabel('asset', 'en')).toBe('Asset');
    expect(accountingAgingBucketLabel('90+', 'ar')).toBe('أكثر من 90 يوماً');
    expect(workflowEventLabel('journal.posted', 'ar')).toContain('ترحيل');
    expect(workflowEventLabel('settings.updated', 'en')).toBe('Settings updated');
  });

  it('marks posted reversals and undone cheque ops as cancelled tone', () => {
    expect(
      accountingStatusTone({
        status: 'posted',
        sourceType: 'journal_reversal',
        text: 'عكس قيد',
      }),
    ).toBe('bad');
    expect(
      accountingStatusTone({
        status: 'posted',
        sourceType: 'cheque_op_undone',
      }),
    ).toBe('bad');
    expect(accountingStatusTone({ status: 'posted', sourceType: 'cheque_clear' })).toBe('good');
    expect(accountingStatusTone({ status: 'draft' })).toBe('review');
    expect(
      accountingStatusChipLabel(
        { status: 'posted', sourceType: 'journal_reversal', text: 'عكس القيد' },
        'ar',
      ),
    ).toBe('معكوس');
  });
});
