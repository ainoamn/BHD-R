import { createHash } from 'node:crypto';
import type { Keyring } from './encryption.js';

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'production' ||
    env.BHD_R_FORCE_PRODUCTION === '1' ||
    env.VERCEL_ENV === 'production'
  );
}

/**
 * AES-GCM keyring derived from FIELD_ENCRYPTION_KEY_V* env vars.
 * Production never falls back to a development key.
 */
export function buildFieldKeyring(purpose: string, env: NodeJS.ProcessEnv = process.env): Keyring {
  const entries = Object.entries(env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && Boolean(value),
  );
  if (entries.length === 0) {
    if (isProductionRuntime(env)) {
      throw new Error('FIELD_ENCRYPTION_KEY_V1_required');
    }
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  }
  return {
    activeVersion: env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1',
    keys: Object.fromEntries(
      entries.map(([name, value]) => [
        name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
        createHash('sha256')
          .update(`${value ?? ''}\0${purpose}`)
          .digest(),
      ]),
    ),
  };
}

/** True when value looks like an encryptField() envelope JSON string. */
export function looksLikeEncryptedField(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"A256GCM"')) return false;
  try {
    const parsed = JSON.parse(trimmed) as { alg?: unknown; v?: unknown; data?: unknown };
    return (
      parsed.alg === 'A256GCM' && typeof parsed.v === 'string' && typeof parsed.data === 'string'
    );
  } catch {
    return false;
  }
}
