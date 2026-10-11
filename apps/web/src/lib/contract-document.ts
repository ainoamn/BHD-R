import type { NumberedTermsBlock, TermsLetterhead } from '@/lib/booking-terms';

export type ContractFileKind = 'signature' | 'id-front' | 'id-back' | 'selfie';

export const CONTRACT_FILE_FIELDS: Record<ContractFileKind, string> = {
  signature: 'signaturePng',
  'id-front': 'idFrontPng',
  'id-back': 'idBackPng',
  selfie: 'selfiePng',
};

type Money = { amountMinor: string; currency: string };
type Stamp = { at: string; notes: string | null };

/** Everything needed to render the contract as its original document. */
export interface ContractDocument {
  type: 'stay' | 'lease' | 'sale';
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  templateHtml: string | null;
  letterhead: TermsLetterhead | null;
  amount: Money | null;
  deposit: Money | null;
  stayType: string | null;
  source: { type: string; referenceCode: string | null; stayBookingId: string | null } | null;
  approval: { mode: string | null; byName: string | null; at: string | null } | null;
  tenantContact: { email: string | null; phone: string | null } | null;
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
  }>;
  /** Files captured during e-sign; ID images only listed when the viewer may see them. */
  files: Array<{ kind: ContractFileKind; signedAt: string | null }>;
  stay: {
    status: string;
    nights: number | null;
    adults: number | null;
    children: number | null;
    checkIn: Stamp | null;
    checkOut: Stamp | null;
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
