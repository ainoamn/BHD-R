/**
 * Long-term lease renewal timing:
 * - Owner may open renewal only when ≤ 90 days remain (≈ 3 months).
 * - At 100 days remaining: one heads-up email to the tenant.
 * - From day 90 down to completion: daily email + WhatsApp until the renewal
 *   addendum is signed (docs required before sign).
 */

export const RENEWAL_OPEN_WITHIN_DAYS = 90;
export const RENEWAL_HEADS_UP_DAYS = 100;

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Days left until endsOn from today (negative if already past). */
export function leaseDaysRemaining(endsOn: string, today: string): number {
  return daysBetweenIso(today, endsOn.slice(0, 10));
}

/** True when the owner/tenant may start or continue a renewal offer. */
export function isLeaseRenewalWindowOpen(endsOn: string, today: string): boolean {
  const remaining = leaseDaysRemaining(endsOn, today);
  return remaining <= RENEWAL_OPEN_WITHIN_DAYS;
}

export function renewalTooEarlyMessage(ar: boolean, daysRemaining: number): string {
  if (ar) {
    return `لا يمكن بدء تجديد عقد الإيجار طويل الأمد قبل 3 أشهر من انتهائه. المتبقي حالياً ${daysRemaining} يوماً — يُفتح التجديد عند بقاء ${RENEWAL_OPEN_WITHIN_DAYS} يوماً أو أقل.`;
  }
  return `Long-term leases can only be renewed within 3 months of expiry. ${daysRemaining} days remain — renewal opens at ${RENEWAL_OPEN_WITHIN_DAYS} days or fewer.`;
}
