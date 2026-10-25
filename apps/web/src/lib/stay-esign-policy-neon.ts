import 'server-only';
import { resolveApprovalPolicy } from '@/lib/approval-policy-neon';
import { getDatabase } from '@/lib/public-booking-neon';
import { isStayEsignRequiredServer } from '@/lib/stay-esign-flags';

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
    const { db } = getDatabase();
    return db.transaction(async (tx) => {
      const resolved = await resolveApprovalPolicy(tx, organizationId, propertyId, 'daily');
      return resolved.policy.electronicSignature;
    });
  } catch {
    return isStayEsignRequiredServer();
  }
}
