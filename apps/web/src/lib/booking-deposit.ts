/** Deposit charged for a booking mode: purchase uses its own amount, else the unit deposit. */
export function depositForMode(
  mode: 'rent' | 'sale',
  unitDepositMinor: string | null | undefined,
  saleDepositMinor: string | null | undefined,
): string | null {
  const pick = mode === 'sale' && saleDepositMinor ? saleDepositMinor : unitDepositMinor;
  return pick && pick !== '0' ? pick : null;
}
