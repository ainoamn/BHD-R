import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundUrl,
  createCsrfToken,
  createTotpCode,
  decryptField,
  encryptField,
  escapeHtml,
  generateTotpSecret,
  hashPassword,
  rotateEncryptedField,
  sanitizeDocumentTemplate,
  sanitizeRichText,
  verifyCsrfToken,
  verifyPassword,
  verifyTotp,
} from '../src/index.js';

describe('security primitives', () => {
  it('encrypts with context and rotates key versions', () => {
    const v1 = new Uint8Array(32).fill(1);
    const v2 = new Uint8Array(32).fill(2);
    const first = encryptField('97123456', { activeVersion: 'v1', keys: { v1 } }, 'tenant:phone');
    expect(decryptField(first, { activeVersion: 'v1', keys: { v1 } }, 'tenant:phone')).toBe(
      '97123456',
    );
    const rotated = rotateEncryptedField(
      first,
      { activeVersion: 'v2', keys: { v1, v2 } },
      'tenant:phone',
    );
    expect(decryptField(rotated, { activeVersion: 'v2', keys: { v1, v2 } }, 'tenant:phone')).toBe(
      '97123456',
    );
    expect(rotated).not.toBe(first);
  });

  it('binds CSRF tokens to the session', () => {
    const token = createCsrfToken('session-a', 'a-secure-secret-value');
    expect(verifyCsrfToken(token, 'session-a', 'a-secure-secret-value')).toBe(true);
    expect(verifyCsrfToken(token, 'session-b', 'a-secure-secret-value')).toBe(false);
  });

  it('hashes and verifies passwords', async () => {
    const encoded = await hashPassword('A long unique passphrase 2026!');
    expect(await verifyPassword('A long unique passphrase 2026!', encoded)).toBe(true);
    expect(await verifyPassword('wrong password', encoded)).toBe(false);
  });

  it('blocks private payment endpoints and non-HTTPS URLs', async () => {
    await expect(
      assertSafeOutboundUrl('http://pay.example.com', async () => ['8.8.8.8']),
    ).rejects.toThrow();
    await expect(
      assertSafeOutboundUrl('https://pay.example.com', async () => ['127.0.0.1']),
    ).rejects.toThrow();
    await expect(
      assertSafeOutboundUrl('https://pay.example.com', async () => ['::ffff:127.0.0.1']),
    ).rejects.toThrow();
    await expect(
      assertSafeOutboundUrl('https://pay.example.com', async () => ['8.8.8.8'], [
        'pay.example.com',
      ]),
    ).resolves.toBeDefined();
  });

  it('closes invoice/POS rich-text XSS vectors', () => {
    expect(
      sanitizeRichText('<img src=x onerror=alert(1)><p onclick=x>safe</p><script>x</script>'),
    ).toBe('<p>safe</p>');
    expect(escapeHtml('<svg onload=alert(1)>')).not.toContain('<svg');
  });

  it('closes contract, invoice, POS and restaurant print-template XSS vectors', () => {
    const safe = sanitizeDocumentTemplate(
      '<section><h1>Invoice</h1><img src="javascript:alert(1)" onerror="alert(2)"><a href="javascript:alert(3)">pay</a><style>@import url(https://evil.test/x);</style><script>alert(4)</script></section>',
    );
    expect(safe).toContain('<section><h1>Invoice</h1>');
    expect(safe).not.toMatch(/javascript:|onerror|@import|<script/i);
  });

  it('accepts TOTP once and rejects replayed counters', () => {
    const secret = generateTotpSecret();
    const timeMs = 1_800_000_000_000;
    const code = createTotpCode(secret, timeMs);
    const first = verifyTotp({ code, secret, timeMs });
    expect(first.valid).toBe(true);
    expect(verifyTotp({ code, secret, timeMs, lastAcceptedCounter: first.counter }).valid).toBe(
      false,
    );
  });
});
