import { describe, expect, it } from 'vitest';
import { sanitizeContractHtml } from '../../src/lib/contract-document';

describe('sanitizeContractHtml', () => {
  it('keeps simple document markup', () => {
    expect(sanitizeContractHtml('<h1>عقد إيجار</h1><p>نص <strong>العقد</strong></p>')).toBe(
      '<h1>عقد إيجار</h1><p>نص <strong>العقد</strong></p>',
    );
  });

  it('drops scripts, handlers and unknown tags', () => {
    const html = sanitizeContractHtml(
      '<p onclick="x()">a</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">b</a>',
    );
    expect(html).toBe('<p>a</p>b');
  });

  it('returns null for empty input', () => {
    expect(sanitizeContractHtml('   ')).toBeNull();
    expect(sanitizeContractHtml(null)).toBeNull();
  });
});
