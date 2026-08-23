import { describe, expect, it } from 'vitest';
import { sanitizeDocumentFragment, wrapPrintableHtml } from '../src/pdf/sanitize.js';

describe('print HTML sanitization regression', () => {
  it('removes scripts, event handlers, active links and remote images', () => {
    const dirty = `<h1 onclick="alert(1)">Invoice</h1><script>alert(1)</script><img src="http://169.254.169.254/latest/meta-data"><a href="javascript:alert(1)">x</a>`;
    const clean = sanitizeDocumentFragment(dirty);
    expect(clean).toContain('<h1>Invoice</h1>');
    expect(clean).not.toMatch(/script|onclick|169\.254|javascript:|<img|<a/i);
  });

  it('wraps output in a deny-by-default CSP', () => {
    const html = wrapPrintableHtml('<p>آمن</p>', 'ar');
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain('dir="rtl"');
  });
});
