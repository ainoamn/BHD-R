import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=|\s|-/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number, digits: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpCode(
  secret: string,
  timeMs = Date.now(),
  periodSeconds = 30,
  digits = 6,
): string {
  return hotp(secret, Math.floor(timeMs / 1000 / periodSeconds), digits);
}

export function verifyTotp(input: {
  code: string;
  secret: string;
  timeMs?: number;
  periodSeconds?: number;
  digits?: number;
  window?: number;
  lastAcceptedCounter?: number | null;
}): { valid: boolean; counter: number | null } {
  const period = input.periodSeconds ?? 30;
  const digits = input.digits ?? 6;
  const window = Math.min(Math.max(input.window ?? 1, 0), 1);
  if (!new RegExp(`^\\d{${digits}}$`).test(input.code)) return { valid: false, counter: null };
  const current = Math.floor((input.timeMs ?? Date.now()) / 1000 / period);
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = current + delta;
    if (counter <= (input.lastAcceptedCounter ?? -1)) continue;
    const expected = Buffer.from(hotp(input.secret, counter, digits));
    const supplied = Buffer.from(input.code);
    if (expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied)) {
      return { valid: true, counter };
    }
  }
  return { valid: false, counter: null };
}

export function totpUri(input: { secret: string; account: string; issuer?: string }): string {
  const issuer = input.issuer ?? 'BHD R';
  const label = `${issuer}:${input.account}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}
