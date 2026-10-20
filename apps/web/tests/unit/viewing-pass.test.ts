import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  issueViewingPassToken,
  openViewingPassToken,
  randomViewingPin,
  randomViewingUsername,
} from '@/lib/viewing-pass';

const VIEWING = '86f47be6-1111-4222-8333-abcdef012345';

describe('viewing-pass', () => {
  const previous = process.env.BHD_R_SESSION_SECRET;

  beforeEach(() => {
    process.env.BHD_R_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
  });

  afterEach(() => {
    process.env.BHD_R_SESSION_SECRET = previous;
  });

  it('issues a six-digit PIN', () => {
    expect(randomViewingPin()).toMatch(/^\d{6}$/);
  });

  it('issues a short gate username (handover-style)', () => {
    expect(randomViewingUsername()).toMatch(/^V\d{6}$/);
  });

  it('round-trips a sealed viewing token before expiry', () => {
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const token = issueViewingPassToken(VIEWING, expires);
    expect(openViewingPassToken(token)).toBe(VIEWING);
  });

  it('rejects an expired token', () => {
    const expires = new Date(Date.now() - 1_000);
    const token = issueViewingPassToken(VIEWING, expires);
    expect(openViewingPassToken(token)).toBeNull();
  });

  it('rejects a forged token', () => {
    expect(openViewingPassToken('not-a-real-token-value-here-aaaaaaaaaaaa')).toBeNull();
  });
});
