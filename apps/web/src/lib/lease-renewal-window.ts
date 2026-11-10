/**
 * Long-term lease renewal timing:
 * - Staff may open renewal only when ≤ 90 days remain (≈ 3 months).
 * - Org owner / org admin / property owner may renew earlier as an exception
 *   (with an explicit acknowledgement when remaining time is still long).
 * - At 100 days remaining: one heads-up email to the tenant.
 * - From day 90 down to completion: daily email + WhatsApp until the renewal
 *   addendum is signed (docs required before sign).
 */

export const RENEWAL_OPEN_WITHIN_DAYS = 90;
export const RENEWAL_HEADS_UP_DAYS = 100;

/** Roles allowed to renew outside the normal 90-day window (not staff). */
export const RENEWAL_EARLY_EXCEPTION_ROLES = [
  'organization_owner',
  'organization_admin',
  'property_owner',
] as const;

export type RenewalEarlyExceptionRole = (typeof RENEWAL_EARLY_EXCEPTION_ROLES)[number];

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Days left until endsOn from today (negative if already past). */
export function leaseDaysRemaining(endsOn: string, today: string): number {
  return daysBetweenIso(today, endsOn.slice(0, 10));
}

/**
 * Visual urgency for leases still in force:
 * - d30: ≤ 30 days (red)
 * - d60: ≤ 60 days (orange)
 * - d90: ≤ 90 days (amber/yellow)
 */
export type LeaseExpiryBand = 'd30' | 'd60' | 'd90';

export function leaseExpiryBand(
  endsOn: string | null | undefined,
  today: string,
): LeaseExpiryBand | null {
  if (!endsOn) return null;
  const remaining = leaseDaysRemaining(endsOn, today);
  if (remaining < 0) return null;
  if (remaining <= 30) return 'd30';
  if (remaining <= 60) return 'd60';
  if (remaining <= 90) return 'd90';
  return null;
}

export function leaseExpiryBandLabel(band: LeaseExpiryBand, locale: 'ar' | 'en'): string {
  if (locale === 'ar') {
    if (band === 'd30') return 'خلال 30 يوماً';
    if (band === 'd60') return 'خلال 60 يوماً';
    return 'خلال 90 يوماً';
  }
  if (band === 'd30') return 'Within 30 days';
  if (band === 'd60') return 'Within 60 days';
  return 'Within 90 days';
}

/** True when the normal renewal window is open (≤ 90 days left). */
export function isLeaseRenewalWindowOpen(endsOn: string, today: string): boolean {
  const remaining = leaseDaysRemaining(endsOn, today);
  return remaining <= RENEWAL_OPEN_WITHIN_DAYS;
}

/** Owner / org admin / property owner — not ordinary staff. */
export function canRenewLeaseEarlyException(roles: readonly string[] | null | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((role) =>
    (RENEWAL_EARLY_EXCEPTION_ROLES as readonly string[]).includes(role),
  );
}

export function renewalTooEarlyMessage(ar: boolean, daysRemaining: number): string {
  if (ar) {
    return `لا يمكن بدء تجديد عقد الإيجار طويل الأمد قبل 3 أشهر من انتهائه. المتبقي حالياً ${daysRemaining} يوماً — يُفتح التجديد عند بقاء ${RENEWAL_OPEN_WITHIN_DAYS} يوماً أو أقل.`;
  }
  return `Long-term leases can only be renewed within 3 months of expiry. ${daysRemaining} days remain — renewal opens at ${RENEWAL_OPEN_WITHIN_DAYS} days or fewer.`;
}

/** Warning when a privileged actor renews while a long remainder is still on the lease. */
export function renewalEarlyExceptionWarning(ar: boolean, daysRemaining: number): string {
  if (ar) {
    return `تنبيه: يتبقّى على هذا العقد ${daysRemaining} يوماً (أكثر من ${RENEWAL_HEADS_UP_DAYS} يوماً). التجديد الآن استثناء لمدير المؤسسة أو المالك فقط — أكّد أنك تريد المتابعة.`;
  }
  return `Warning: ${daysRemaining} days remain on this lease (more than ${RENEWAL_HEADS_UP_DAYS} days). Early renewal is an exception for the organization manager or owner only — confirm you want to continue.`;
}
