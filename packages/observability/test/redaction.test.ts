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

  it('redacts secrets nested in arrays, headers and request bodies', () => {
    const result = sanitizeForAudit({
      headers: { authorization: 'Bearer very-secret-token', cookie: 'session=secret' },
      body: {
        contacts: [
          { name: 'Safe name', credentials: { clientSecret: 'gateway-secret' } },
          { apiKey: 'bhd_live_secret' },
        ],
      },
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    });
    expect(result).toEqual({
      headers: { authorization: REDACTED, cookie: REDACTED },
      body: {
        contacts: [{ name: 'Safe name', credentials: REDACTED }, { apiKey: REDACTED }],
      },
      jwt: REDACTED,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /very-secret-token|session=secret|gateway-secret|bhd_live_secret|eyJhbGci/i,
    );
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
