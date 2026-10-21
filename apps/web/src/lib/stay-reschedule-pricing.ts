/**
 * Price rule when a guest moves a stay to new dates and/or period:
 * - The new selection is priced at the rates shown on the calendar (offers included).
 * - The guest never gets money back: if the new selection costs less, the booking keeps
 *   its original paid amount and the difference is forfeited (no period downgrade refund).
 * - If the new selection costs more, the booking takes the new price. A paid booking
 *   must pay the difference online (`requiresPayment`) before the move applies.
 */
export type StayRescheduleCharge = {
  originalTotalMinor: string;
  quotedTotalMinor: string;
  chargedTotalMinor: string;
  /** Amount the guest gives up because the new dates are cheaper. */
  forfeitedMinor: string;
  /** Extra the guest owes because the new dates are dearer. */
  extraDueMinor: string;
  keptOriginalPrice: boolean;
  requiresPayment: boolean;
};

function toMinor(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new RangeError(`${field} must be a non-negative integer string`);
  return BigInt(value);
}

export function stayRescheduleCharge(input: {
  originalTotalMinor: string;
  quotedTotalMinor: string;
  paid: boolean;
}): StayRescheduleCharge {
  const original = toMinor(input.originalTotalMinor, 'originalTotalMinor');
  const quoted = toMinor(input.quotedTotalMinor, 'quotedTotalMinor');
  const keptOriginalPrice = quoted < original;
  const extraDue = quoted > original ? quoted - original : 0n;
  return {
    originalTotalMinor: original.toString(),
    quotedTotalMinor: quoted.toString(),
    chargedTotalMinor: (keptOriginalPrice ? original : quoted).toString(),
    forfeitedMinor: (keptOriginalPrice ? original - quoted : 0n).toString(),
    extraDueMinor: extraDue.toString(),
    keptOriginalPrice,
    requiresPayment: input.paid && extraDue > 0n,
  };
}
