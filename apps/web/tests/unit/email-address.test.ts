import { describe, expect, it } from 'vitest';
import { isPlausibleEmail, normalizeEmailInput } from '@/lib/email-address';

describe('normalizeEmailInput', () => {
  it('strips RTL embedding marks that break Resend', () => {
    const dirty = '\u202Bameed.19@gmail.com\u202C';
    expect(normalizeEmailInput(dirty)).toBe('ameed.19@gmail.com');
    expect(isPlausibleEmail(dirty)).toBe(true);
  });

  it('lowercases and trims', () => {
    expect(normalizeEmailInput('  Guard@Example.COM ')).toBe('guard@example.com');
  });
});
