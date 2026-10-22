import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';
import type { ContractAnnexLink } from '@/lib/contract-annex';

export type ContractFileKind = 'signature' | 'id-front' | 'id-back' | 'selfie';

export const CONTRACT_FILE_FIELDS: Record<ContractFileKind, string> = {
  signature: 'signaturePng',
  'id-front': 'idFrontPng',
  'id-back': 'idBackPng',
  selfie: 'selfiePng',
};

type Money = { amountMinor: string; currency: string };
type Stamp = {
  at: string;
  notes: string | null;
  noteKeys: string[];
  customNote: string | null;
  important: boolean;
};

/** Who received the premises at check-in; `documentHref` only for booking managers. */
export type ContractHandoverRecipient = {
  name: string | null;
  phone: string | null;
  documentKind: string | null;
  documentHref: string | null;
};

/** A contracting party as written on the contract; missing details stay null (printed as a blank line). */
export interface ContractPartyCard {
  name: string;
  entityType: 'person' | 'company';
  civilId: string | null;
  passport: string | null;
  nationality: string | null;
  crNumber: string | null;
  signatoryName: string | null;
  signatoryCivilId: string | null;
  phone: string | null;
  email: string | null;
}

export interface ContractPremises {
  propertyNameAr: string;
  propertyNameEn: string;
  kind: string;
  category: string;
  serialNumber: string | null;
  governorate: string;
  wilayat: string;
  city: string;
  area: string | null;
  street: string | null;
  buildingNumber: string | null;
  postalCode: string | null;
  deedNumber: string | null;
  plotNumber: string | null;
  furnishing: string | null;
  parkingSpaces: number | null;
  builtUpArea: string | null;
  floorsCount: number | null;
  yearBuilt: number | null;
  unit: {
    code: string;
    nameAr: string;
    nameEn: string;
    floor: string | null;
    bedrooms: number;
    bathrooms: number;
    majlis: number;
    halls: number;
    kitchens: number;
    hasPool: boolean;
    areaSquareMeters: string | null;
  } | null;
}

/**
 * Where the property is: the map pin when coordinates are known, and the link the QR code
 * opens (Google Maps at the pin, or the link the owner saved with the property).
 */
export interface PropertyLocation {
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string;
  qrSvg: string | null;
}

/** Everything needed to render the contract as its original document. */
export interface ContractDocument {
  type: 'stay' | 'lease' | 'sale';
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  /** Contract wording per language (sanitised); either may be missing. */
  template: { ar: string | null; en: string | null };
  letterhead: TermsLetterhead | null;
  amount: Money | null;
  deposit: Money | null;
  stayType: string | null;
  /** Property-configured clock times for this stay type (HH:MM). */
  checkInTime: string | null;
  checkOutTime: string | null;
  /**
   * Stay date-change addendum: from → to terms, money difference, and both-party approvals.
   * Present when `kind === 'amendment'` for a stay reschedule.
   */
  rescheduleChange: {
    previous: {
      startsOn: string;
      endsOn: string | null;
      stayType: string | null;
      checkInTime: string | null;
      checkOutTime: string | null;
      amount: Money | null;
    };
    next: {
      startsOn: string;
      endsOn: string | null;
      stayType: string | null;
      checkInTime: string | null;
      checkOutTime: string | null;
      amount: Money | null;
    };
    difference: {
      originalTotalMinor: string | null;
      quotedTotalMinor: string | null;
      chargedTotalMinor: string | null;
      forfeitedMinor: string | null;
      extraDueMinor: string | null;
    } | null;
    approvals: {
      guestAt: string | null;
      ownerAt: string | null;
    };
  } | null;
  /**
   * Stay check-out cancellation addendum: when the contract was cancelled, scheduled vs
   * actual check-out, and late-return duration for the owner’s deposit decision.
   */
  terminationClose: {
    cancelledAt: string;
    effectiveOn: string;
    recordedBy: string | null;
    scheduledCheckOutAt: string | null;
    actualCheckOutAt: string | null;
    lateMinutes: number;
    lateLabelAr: string;
    lateLabelEn: string;
  } | null;
  source: { type: string; referenceCode: string | null; stayBookingId: string | null } | null;
  approval: { mode: string | null; byName: string | null; at: string | null } | null;
  tenantContact: { email: string | null; phone: string | null } | null;
  owner: ContractPartyCard | null;
  tenant: ContractPartyCard | null;
  premises: ContractPremises | null;
  location: PropertyLocation | null;
  terms: NumberedTermsBlock[];
  termsAcceptedAt: string | null;
  signatures: Array<{
    id: string;
    role: string;
    method: string;
    name: string | null;
    email: string | null;
    signedAt: string;
    hash: string;
    /** Electronic-signature serial number, e.g. ES-2026-000012. */
    serial: string | null;
  }>;
  /** Public verification link printed as a QR code; never exposes terms or documents. */
  verification: { url: string; qrSvg: string } | null;
  /** Files captured during e-sign; ID images only listed when the viewer may see them. */
  files: Array<{ kind: ContractFileKind; signedAt: string | null }>;
  stay: {
    status: string;
    nights: number | null;
    adults: number | null;
    children: number | null;
    checkIn: Stamp | null;
    checkOut: Stamp | null;
    recipient: ContractHandoverRecipient | null;
    guestPageHref: string;
  } | null;
  addenda: Array<{
    id: string;
    reference: string;
    kind: string;
    status: string;
    createdAt: string;
  }>;
  parent: { id: string; reference: string } | null;
  /** Stay annexes (check-in, check-out, deposit refund), each a separate document. */
  annexes: ContractAnnexLink[];
  /**
   * The website booking a rent or purchase contract was issued from: its terms are part of
   * the contract, and the QR opens the booking document for its parties.
   */
  booking?: {
    referenceCode: string;
    url: string;
    qrSvg: string | null;
    termsAcceptedAt: string | null;
    signedAt: string | null;
  } | null;
  /** Rent or purchase reservation the customer signs after paying the booking deposit. */
  reservation?: {
    mode: 'rent' | 'sale';
    depositPaid: Money | null;
    paidAt: string | null;
    reservedUntil: string | null;
  };
}

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'br',
  'hr',
  'blockquote',
]);

/** Template HTML reduced to plain formatting tags: no attributes, scripts, styles or links. */
export function sanitizeContractHtml(html: string | null | undefined): string | null {
  if (!html?.trim()) return null;
  const cleaned = html
    .replace(/<(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, name: string) => {
      const lower = name.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return '';
      const closing = tag.startsWith('</');
      if (lower === 'br' || lower === 'hr') return closing ? '' : `<${lower}>`;
      return closing ? `</${lower}>` : `<${lower}>`;
    })
    .replace(/<(?![a-z/])/gi, '&lt;')
    .trim();
  return cleaned || null;
}
