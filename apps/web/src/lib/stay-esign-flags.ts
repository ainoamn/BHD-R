/** Post-pay e-sign is on unless explicitly disabled with `0` / `false`. */

function isEnabledFlag(value: string | undefined): boolean {
  const normalized = value?.replace(/^\uFEFF/, '').trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

/** Client / build-time: drives returnPath after payment. Platform kill-switch only. */
export function isStayEsignRequiredClient(): boolean {
  return isEnabledFlag(process.env.NEXT_PUBLIC_STAY_ESIGN_REQUIRED);
}

/** Server platform kill-switch (env). Org/property policy can still turn e-sign off per daily contract. */
export function isStayEsignRequiredServer(): boolean {
  return isEnabledFlag(process.env.STAY_ESIGN_REQUIRED);
}

/**
 * Daily-stay e-sign: platform env must allow it, and the daily approval policy's
 * `electronicSignature` must be on (defaults to on).
 */
export async function isStayEsignRequiredForProperty(
  organizationId: string,
  propertyId: string,
): Promise<boolean> {
  if (!isStayEsignRequiredServer()) return false;
  try {
    const { getDatabase } = await import('@/lib/public-booking-neon');
    const { resolveApprovalPolicy } = await import('@/lib/approval-policy-neon');
    const { db } = getDatabase();
    return db.transaction(async (tx) => {
      const resolved = await resolveApprovalPolicy(tx, organizationId, propertyId, 'daily');
      return resolved.policy.electronicSignature;
    });
  } catch {
    return isStayEsignRequiredServer();
  }
}

export function stayEsignReturnPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/stays/booking/sign?ref=${encodeURIComponent(referenceCode)}`;
}

export function stayConfirmedReturnPath(locale: string, referenceCode: string): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/${safeLocale}/stays/booking/confirmed?ref=${encodeURIComponent(referenceCode)}`;
}

export function localeFromReturnPath(returnPath: string | null | undefined): 'ar' | 'en' {
  if (returnPath?.startsWith('/en/')) return 'en';
  return 'ar';
}
