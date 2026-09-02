function parseBoolFlag(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null || raw.trim() === '') return defaultValue;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

/** Explicit pilot flag for sandbox stay/invoice payments (including production stays pilot). */
export function isPaymentSandboxPilotEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  if (
    parseBoolFlag(source.PAYMENT_SANDBOX_ENABLED) ||
    parseBoolFlag(source.ALLOW_BOOKING_SANDBOX)
  ) {
    return true;
  }
  // Stays pilot on production: sandbox until a live PSP adapter is configured.
  return parseBoolFlag(source.STAYS_PLATFORM_ENABLED, false);
}
