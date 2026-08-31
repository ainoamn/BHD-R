/**
 * Hospitality KPIs for stays (room-night based).
 * Occupancy = occupied / available
 * ADR = roomRevenue / occupied
 * RevPAR = roomRevenue / available (= Occupancy × ADR)
 *
 * Money stays in minor-unit integer strings — never Number floats for amounts.
 */

export type StayPerformanceInput = {
  availableRoomNights: number;
  occupiedRoomNights: number;
  /** Room revenue in minor units (exclude one-time cleaning when possible). */
  roomRevenueMinor: string;
};

export type StayPerformanceMetrics = {
  availableRoomNights: number;
  occupiedRoomNights: number;
  roomRevenueMinor: string;
  /** Occupancy ratio 0–1 as fixed 6-decimal string, or null if no capacity. */
  occupancyRatio: string | null;
  /** Occupancy percent 0–100 as fixed 2-decimal string, or null. */
  occupancyPercent: string | null;
  /** ADR in minor units (integer string), or null if no occupied nights. */
  adrMinor: string | null;
  /** RevPAR in minor units (integer string), or null if no available nights. */
  revparMinor: string | null;
};

function parseNonNegativeInt(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new RangeError(`${field} must be a non-negative integer string`);
  }
  return BigInt(value);
}

/** Floor-divide bigint with half-up rounding for money averages. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const half = denominator / 2n;
  return (numerator + half) / denominator;
}

/**
 * Format a 0–1 ratio as a fixed-scale decimal string without floats.
 * scale=6 → "0.500000"
 */
function ratioToFixed(numerator: bigint, denominator: bigint, scale: number): string {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const factor = 10n ** BigInt(scale);
  const scaled = (numerator * factor + denominator / 2n) / denominator;
  const whole = scaled / factor;
  const frac = scaled % factor;
  return `${whole.toString()}.${frac.toString().padStart(scale, '0')}`;
}

export function computeStayPerformanceMetrics(
  input: StayPerformanceInput,
): StayPerformanceMetrics {
  if (!Number.isInteger(input.availableRoomNights) || input.availableRoomNights < 0) {
    throw new RangeError('availableRoomNights must be a non-negative integer');
  }
  if (!Number.isInteger(input.occupiedRoomNights) || input.occupiedRoomNights < 0) {
    throw new RangeError('occupiedRoomNights must be a non-negative integer');
  }
  if (input.occupiedRoomNights > input.availableRoomNights) {
    throw new RangeError('occupiedRoomNights cannot exceed availableRoomNights');
  }

  const revenue = parseNonNegativeInt(input.roomRevenueMinor, 'roomRevenueMinor');
  const available = BigInt(input.availableRoomNights);
  const occupied = BigInt(input.occupiedRoomNights);

  let occupancyRatio: string | null = null;
  let occupancyPercent: string | null = null;
  if (available > 0n) {
    occupancyRatio = ratioToFixed(occupied, available, 6);
    occupancyPercent = ratioToFixed(occupied * 100n, available, 2);
  }

  const adrMinor =
    occupied > 0n ? divideRoundHalfUp(revenue, occupied).toString() : null;
  const revparMinor =
    available > 0n ? divideRoundHalfUp(revenue, available).toString() : null;

  return {
    availableRoomNights: input.availableRoomNights,
    occupiedRoomNights: input.occupiedRoomNights,
    roomRevenueMinor: revenue.toString(),
    occupancyRatio,
    occupancyPercent,
    adrMinor,
    revparMinor,
  };
}
