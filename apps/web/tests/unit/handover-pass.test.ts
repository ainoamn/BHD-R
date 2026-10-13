import { beforeAll, describe, expect, it } from 'vitest';
import {
  HANDOVER_PASS_WINDOW_MS,
  issueHandoverPass,
  openHandoverPass,
  verifyHandoverCode,
} from '@/lib/handover-pass';

const RESERVATION = 'b0fd4e25-3da5-4822-98ec-4661ef773814';
const NOW = new Date('2026-10-13T10:02:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeAll(() => {
  process.env.BHD_R_SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
});

describe('handover pass', () => {
  it('opens to the reservation it was issued for', () => {
    const pass = issueHandoverPass(RESERVATION, NOW);
    expect(openHandoverPass(pass.token, NOW)).toBe(RESERVATION);
    expect(pass.code).toMatch(/^\d{6}$/);
  });

  it('does not reveal the reservation in the token', () => {
    const { token } = issueHandoverPass(RESERVATION, NOW);
    expect(token).not.toContain(RESERVATION.replaceAll('-', '').slice(0, 8));
    expect(Buffer.from(token, 'base64url').toString('hex')).not.toContain('b0fd4e25');
  });

  it('stays valid for fifteen minutes and lapses after twenty', () => {
    const { token } = issueHandoverPass(RESERVATION, NOW);
    expect(openHandoverPass(token, later(14))).toBe(RESERVATION);
    expect(openHandoverPass(token, later(21))).toBeNull();
  });

  it('rejects a token from the future or an altered one', () => {
    const { token } = issueHandoverPass(RESERVATION, later(10));
    expect(openHandoverPass(token, NOW)).toBeNull();
    const fresh = issueHandoverPass(RESERVATION, NOW).token;
    const flipped = `${fresh.slice(0, 20)}${fresh[20] === 'A' ? 'B' : 'A'}${fresh.slice(21)}`;
    expect(openHandoverPass(flipped, NOW)).toBeNull();
    expect(openHandoverPass('not-a-token', NOW)).toBeNull();
  });

  it('rejects a token sealed with another secret', () => {
    const { token } = issueHandoverPass(RESERVATION, NOW);
    const saved = process.env.BHD_R_SESSION_SECRET;
    process.env.BHD_R_SESSION_SECRET = 'another-secret-0123456789abcdef0123456789';
    expect(openHandoverPass(token, NOW)).toBeNull();
    process.env.BHD_R_SESSION_SECRET = saved;
  });

  it('accepts the typed code only for its reservation and while live', () => {
    const { code } = issueHandoverPass(RESERVATION, NOW);
    expect(verifyHandoverCode(RESERVATION, code, later(10))).toBe(true);
    expect(verifyHandoverCode('a0fd4e25-3da5-4822-98ec-4661ef773814', code, NOW)).toBe(false);
    expect(verifyHandoverCode(RESERVATION, code, later(21))).toBe(false);
  });

  it('rotates the code every window', () => {
    const first = issueHandoverPass(RESERVATION, NOW);
    const next = issueHandoverPass(RESERVATION, new Date(NOW.getTime() + HANDOVER_PASS_WINDOW_MS));
    expect(next.token).not.toBe(first.token);
    expect(new Date(first.refreshAt).getTime()).toBeLessThanOrEqual(
      NOW.getTime() + HANDOVER_PASS_WINDOW_MS,
    );
  });
});
