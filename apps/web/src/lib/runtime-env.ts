/**
 * Shared Next.js runtime env helpers (P0-04 from security review).
 * Production must never fall back to development secrets.
 */

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.BHD_R_FORCE_PRODUCTION === '1'
  );
}

/** Explicit opt-in for local/sandbox booking payment simulation only. */
export function isBookingSandboxAllowed(): boolean {
  if (process.env.ALLOW_BOOKING_SANDBOX === '1') return true;
  if (process.env.PAYMENT_SANDBOX_ENABLED === 'true') return true;
  if (isProductionRuntime()) return false;
  return process.env.ALLOW_BOOKING_SANDBOX !== '0';
}

export function requireSessionSecret(): Uint8Array {
  const value = process.env.BHD_R_SESSION_SECRET?.trim();
  if (value && value.length >= 32) {
    return new TextEncoder().encode(value);
  }
  if (isProductionRuntime()) {
    throw new Error('BHD_R_SESSION_SECRET_required');
  }
  return new TextEncoder().encode('development-session-secret-at-least-32-characters');
}

export function requireOidcStateSecret(): string {
  const value =
    process.env.BHD_R_OIDC_STATE_SECRET?.trim() ||
    process.env.BHD_R_SESSION_SECRET?.trim() ||
    '';
  if (value.length >= 32) return value;
  if (isProductionRuntime()) {
    throw new Error('BHD_R_OIDC_STATE_SECRET_required');
  }
  return 'development-session-secret-at-least-32-characters';
}

export function requireCsrfSecret(): string {
  const value =
    process.env.CSRF_SECRET?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || '';
  if (value.length >= 32) return value;
  if (isProductionRuntime()) {
    throw new Error('CSRF_SECRET_required');
  }
  return 'development-csrf-secret-must-be-at-least-32-chars';
}
