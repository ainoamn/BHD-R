import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  digest: string;
}

export function generateApiKey(pepper: string): GeneratedApiKey {
  const material = randomBytes(32).toString('base64url');
  const plaintext = `bhdr_live_${material}`;
  return { plaintext, prefix: plaintext.slice(0, 16), digest: hashApiKey(plaintext, pepper) };
}

export function hashApiKey(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('base64url');
}

export function verifyApiKey(value: string, digest: string, pepper: string): boolean {
  const actual = Buffer.from(hashApiKey(value, pepper));
  const expected = Buffer.from(digest);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
