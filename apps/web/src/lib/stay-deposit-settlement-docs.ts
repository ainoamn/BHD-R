/** Shared locale-less paths for deposit settlement documents (guest + accountant). */

/** Bank transfer slip the accountant uploaded when paying out the deposit. */
export function depositTransferReceiptHref(referenceCode: string): string {
  return `/api/public/stays/guest/refund-receipt?ref=${encodeURIComponent(referenceCode)}`;
}

/**
 * Reverse / settlement document for the guest account (إيصال استرداد DR-…):
 * clears the held deposit against the transfer.
 */
export function depositRefundDocHref(referenceCode: string): string {
  return `/stays/booking/deposit-docs?ref=${encodeURIComponent(referenceCode)}&doc=refund`;
}
