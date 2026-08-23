import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const envelopeSchema = z.object({
  v: z.string().regex(/^v\d+$/),
  alg: z.literal('A256GCM'),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

export interface Keyring {
  activeVersion: string;
  keys: Readonly<Record<string, Uint8Array>>;
}

function keyFor(keyring: Keyring, version: string): Uint8Array {
  const key = keyring.keys[version];
  if (!key || key.byteLength !== 32)
    throw new Error(`Missing or invalid encryption key ${version}`);
  return key;
}

export function encryptField(plaintext: string, keyring: Keyring, context: string): string {
  const version = keyring.activeVersion;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(keyring, version), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: version,
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  });
}

export function decryptField(encrypted: string, keyring: Keyring, context: string): string {
  const envelope = envelopeSchema.parse(JSON.parse(encrypted));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(keyring, envelope.v),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function rotateEncryptedField(encrypted: string, keyring: Keyring, context: string): string {
  const envelope = envelopeSchema.parse(JSON.parse(encrypted));
  if (envelope.v === keyring.activeVersion) return encrypted;
  return encryptField(decryptField(encrypted, keyring, context), keyring, context);
}
