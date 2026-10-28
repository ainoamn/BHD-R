import { isProductionRuntime } from '@bhd-r/security';

function cleanSecret(value: string | undefined): string {
  return (
    value
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || ''
  );
}

/** Session signing secret — production never uses development fallbacks. */
export function requireSessionSecretBytes(): Uint8Array {
  const value = cleanSecret(process.env.BHD_R_SESSION_SECRET);
  if (value.length >= 32) return new TextEncoder().encode(value);
  if (isProductionRuntime()) {
    throw new Error('BHD_R_SESSION_SECRET_required');
  }
  return new TextEncoder().encode('development-session-secret-at-least-32-characters');
}

export function requireSessionSecretString(): string {
  const value = cleanSecret(process.env.BHD_R_SESSION_SECRET);
  if (value.length >= 32) return value;
  if (isProductionRuntime()) {
    throw new Error('BHD_R_SESSION_SECRET_required');
  }
  return 'development-session-secret-at-least-32-characters';
}

export function requireCsrfSecret(): string {
  const value = cleanSecret(process.env.CSRF_SECRET);
  if (value.length >= 32) return value;
  if (isProductionRuntime()) {
    throw new Error('CSRF_SECRET_required');
  }
  return 'development-csrf-secret-must-be-at-least-32-chars';
}

export function requirePiiLookupPepper(): string {
  const value =
    cleanSecret(process.env.PII_LOOKUP_PEPPER) || cleanSecret(process.env.BHD_R_SESSION_SECRET);
  if (value.length >= 16) return value;
  if (isProductionRuntime()) {
    throw new Error('PII_LOOKUP_PEPPER_required');
  }
  return 'development-pii-lookup-pepper';
}
