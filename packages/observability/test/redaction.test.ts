import { describe, expect, it } from 'vitest';
import { REDACTED, sanitizeForAudit, sanitizeText } from '../src/index.js';

describe('audit redaction regression', () => {
  it.each([
    'password',
    'authorization',
    'apiKey',
    'key',
    'client_secret',
    'credential',
    'plaintext',
    'totpCode',
    'cookie',
  ])('redacts %s', (key) => {
    expect(sanitizeForAudit({ [key]: 'do-not-leak' })).toEqual({ [key]: REDACTED });
  });

  it('redacts nested arrays, bearer values and JWT-like values', () => {
    const result = sanitizeForAudit({
      nested: [{ note: 'Bearer very-secret-token' }],
      jwt: 'not reached',
    });
    expect(result).toEqual({ nested: [{ note: `Bearer ${REDACTED}` }], jwt: REDACTED });
  });

  it('masks emails in free text', () => {
    expect(sanitizeText('contact ahmed.long@example.com')).toBe('contact ahm***@example.com');
  });

  it('does not mutate the source object', () => {
    const source = { password: 'secret', safe: 'value' };
    sanitizeForAudit(source);
    expect(source.password).toBe('secret');
  });
});
