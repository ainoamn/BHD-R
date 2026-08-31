/**
 * Read-only iCal (ICS) export for stay inventory — no outbound fetch / SSRF surface.
 * Half-open stay ranges [checkIn, checkOut) map to all-day VEVENT DTSTART/DTEND (DTEND exclusive).
 */

export type StayIcsBusyEvent = {
  /** Stable UID local-part (caller supplies opaque id; domain appends @bhd-r.stays). */
  uid: string;
  checkInOn: string;
  checkOutOn: string;
  /** Short busy label — never guest PII. */
  summary: string;
};

export type BuildStayUnitIcsInput = {
  calendarName: string;
  /** PRODUCTID token without wrapping. */
  productId?: string;
  /** UTC stamp YYYYMMDDTHHMMSSZ; defaults to a fixed epoch for pure tests when omitted. */
  dtStampUtc?: string;
  events: readonly StayIcsBusyEvent[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value)) throw new RangeError(`${field} must be YYYY-MM-DD`);
}

/** Escape TEXT values per RFC 5545. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/** Compact YYYY-MM-DD → YYYYMMDD for VALUE=DATE. */
export function icsDateValue(isoDate: string): string {
  assertIsoDate(isoDate, 'date');
  return isoDate.replaceAll('-', '');
}

export function stayLockKindToIcsSummary(kind: string): string {
  switch (kind) {
    case 'hold':
      return 'Busy (Hold)';
    case 'booking':
      return 'Busy (Booking)';
    case 'owner_block':
      return 'Owner block';
    case 'maintenance':
      return 'Maintenance';
    case 'channel':
      return 'Channel block';
    case 'lease':
      return 'Lease block';
    default:
      return 'Busy';
  }
}

/**
 * Build a minimal VCALENDAR document (CRLF line endings).
 */
export function buildStayUnitIcs(input: BuildStayUnitIcsInput): string {
  const productId = input.productId ?? '-//BHD R//Stays//EN';
  const dtStamp = input.dtStampUtc ?? '19700101T000000Z';
  if (!/^\d{8}T\d{6}Z$/.test(dtStamp)) {
    throw new RangeError('dtStampUtc must be YYYYMMDDTHHMMSSZ');
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(productId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
  ];

  for (const event of input.events) {
    assertIsoDate(event.checkInOn, 'checkInOn');
    assertIsoDate(event.checkOutOn, 'checkOutOn');
    if (event.checkOutOn <= event.checkInOn) {
      throw new RangeError('checkOutOn must be after checkInOn');
    }
    const uid = event.uid.includes('@') ? event.uid : `${event.uid}@bhd-r.stays`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${icsDateValue(event.checkInOn)}`,
      `DTEND;VALUE=DATE:${icsDateValue(event.checkOutOn)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
