import { describe, expect, it } from 'vitest';
import { accountingPrintBackHref } from '@/lib/accounting-letterhead';

describe('accountingPrintBackHref', () => {
  it('keeps the from tab and adds focus for the printed document', () => {
    expect(
      accountingPrintBackHref(
        'document',
        '7b8f4590-1ccc-418d-89c4-c4e11e48312f',
        '/owner/accounting?tab=documents',
      ),
    ).toBe(
      '/owner/accounting?tab=documents&focus=7b8f4590-1ccc-418d-89c4-c4e11e48312f',
    );
  });

  it('falls back to the matching tab and reopens the journal/document', () => {
    expect(accountingPrintBackHref('document', '7b8f4590-1ccc-418d-89c4-c4e11e48312f', null)).toBe(
      '/owner/accounting?tab=documents&focus=7b8f4590-1ccc-418d-89c4-c4e11e48312f',
    );
    expect(accountingPrintBackHref('journal', '7b8f4590-1ccc-418d-89c4-c4e11e48312f')).toBe(
      '/owner/accounting?tab=journal&open=7b8f4590-1ccc-418d-89c4-c4e11e48312f&focus=7b8f4590-1ccc-418d-89c4-c4e11e48312f',
    );
    expect(accountingPrintBackHref('report', 'trial-2026-10-18')).toBe('/owner/accounting?tab=reports');
  });

  it('rejects open redirects', () => {
    expect(accountingPrintBackHref('document', 'x', 'https://evil.example/')).toBe(
      '/owner/accounting?tab=documents',
    );
    expect(accountingPrintBackHref('document', 'x', '//evil.example')).toBe(
      '/owner/accounting?tab=documents',
    );
    expect(accountingPrintBackHref('document', 'x', '/owner/properties')).toBe(
      '/owner/accounting?tab=documents',
    );
  });
});
