import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTotpRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = randomBytes(8);
    let encoded = '';
    for (const byte of raw) encoded += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    codes.add(`${encoded.slice(0, 4)}-${encoded.slice(4, 8)}`);
  }
  return [...codes];
}

export function hashTotpRecoveryCode(code: string, pepper: string): string {
  const normalized = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return createHmac('sha256', pepper).update(`totp-recovery:${normalized}`).digest('base64url');
}

export function verifyTotpRecoveryCode(code: string, digest: string, pepper: string): boolean {
  const actual = Buffer.from(hashTotpRecoveryCode(code, pepper));
  const expected = Buffer.from(digest);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function consumeTotpRecoveryDigest(
  digests: string[],
  code: string,
  pepper: string,
): { matched: boolean; remaining: string[] } {
  const remaining: string[] = [];
  let matched = false;
  for (const digest of digests) {
    if (!matched && verifyTotpRecoveryCode(code, digest, pepper)) {
      matched = true;
      continue;
    }
    remaining.push(digest);
  }
  return { matched, remaining };
}
