/**
 * Smart document requirements for long-term leases: which uploads the tenant must provide
 * based on person vs company and Omani vs expatriate (including company signatories).
 */

import { REQUIREMENT_CATALOGUE } from '@/lib/lease-reservation-lifecycle';

export type DocumentProfileKey =
  | 'person_omani'
  | 'person_expat'
  | 'company_base'
  | 'company_signatory_omani'
  | 'company_signatory_expat';

export type DocumentRequirementPick = {
  code: string;
  labelAr: string;
  labelEn: string;
};

export type LeaseDocumentRules = Record<DocumentProfileKey, string[]>;

/** Platform defaults — owner can override from settings. */
export const DEFAULT_LEASE_DOCUMENT_RULES: LeaseDocumentRules = {
  person_omani: ['civil_id', 'salary_certificate', 'bank_statement'],
  person_expat: [
    'passport',
    'resident_card',
    'salary_certificate',
    'employment_letter',
    'bank_statement',
  ],
  company_base: ['commercial_register', 'authorization_letter', 'company_cr_extract'],
  company_signatory_omani: ['signatory_civil_id'],
  company_signatory_expat: ['signatory_passport', 'signatory_resident_card', 'signatory_civil_id'],
};

export const DOCUMENT_PROFILE_LABELS: Record<DocumentProfileKey, [string, string]> = {
  person_omani: ['مستأجر شخصي — عماني', 'Individual tenant — Omani'],
  person_expat: ['مستأجر شخصي — وافد', 'Individual tenant — expatriate'],
  company_base: ['مستأجر شركة — مستندات الشركة', 'Company tenant — company documents'],
  company_signatory_omani: [
    'مفوّض بالتوقيع — عماني',
    'Authorized signatory — Omani',
  ],
  company_signatory_expat: [
    'مفوّض بالتوقيع — وافد',
    'Authorized signatory — expatriate',
  ],
};

const PROFILE_KEYS = Object.keys(DEFAULT_LEASE_DOCUMENT_RULES) as DocumentProfileKey[];

export function sanitizeLeaseDocumentRules(value: unknown): LeaseDocumentRules {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const allowed = new Set(REQUIREMENT_CATALOGUE.map((item) => item.code));
  const out = { ...DEFAULT_LEASE_DOCUMENT_RULES };
  for (const key of PROFILE_KEYS) {
    const raw = source[key];
    if (!Array.isArray(raw)) continue;
    const codes = raw
      .map((item) => String(item ?? '').trim())
      .filter((code) => allowed.has(code) || /^custom_\d+$/.test(code))
      .filter((code, index, all) => all.indexOf(code) === index)
      .slice(0, 12);
    out[key] = codes;
  }
  return out;
}

/** Treat as Omani when nationality text clearly means Oman / Omani. */
export function isOmaniNationality(nationality: string | null | undefined): boolean {
  const value = (nationality ?? '').trim().toLowerCase();
  if (!value) return false;
  return (
    value === 'om' ||
    value === 'omn' ||
    value.includes('oman') ||
    value.includes('عمان') ||
    value.includes('عماني') ||
    value.includes('عمانية')
  );
}

export type TenantDocumentContext = {
  entityType: 'person' | 'company';
  nationality?: string | null | undefined;
  signatoryNationality?: string | null | undefined;
  /** When false, only rent catalogue codes are used. */
  sale?: boolean | undefined;
};

function picksFromCodes(codes: string[], sale: boolean): DocumentRequirementPick[] {
  const catalogue = REQUIREMENT_CATALOGUE.filter((item) => (sale ? item.sale : item.rent));
  const byCode = new Map(catalogue.map((item) => [item.code, item]));
  const out: DocumentRequirementPick[] = [];
  for (const code of codes) {
    const item = byCode.get(code);
    if (!item) continue;
    out.push({ code: item.code, labelAr: item.labelAr, labelEn: item.labelEn });
  }
  return out;
}

/**
 * Suggested uploads for this tenant. Company adds company docs + signatory docs
 * based on the signatory's nationality (falls back to company nationality if empty).
 */
export function suggestLeaseDocuments(
  context: TenantDocumentContext,
  rules: LeaseDocumentRules = DEFAULT_LEASE_DOCUMENT_RULES,
): DocumentRequirementPick[] {
  const sale = Boolean(context.sale);
  const codes = new Set<string>();
  if (context.entityType === 'company') {
    for (const code of rules.company_base) codes.add(code);
    const signatoryOmani = isOmaniNationality(
      context.signatoryNationality || context.nationality,
    );
    // Without a nationality yet, suggest both signatory tracks lightly via civil id + passport.
    if (!context.signatoryNationality?.trim() && !context.nationality?.trim()) {
      for (const code of rules.company_signatory_omani) codes.add(code);
      for (const code of ['signatory_passport', 'signatory_resident_card']) {
        if (rules.company_signatory_expat.includes(code)) codes.add(code);
      }
    } else if (signatoryOmani) {
      for (const code of rules.company_signatory_omani) codes.add(code);
    } else {
      for (const code of rules.company_signatory_expat) codes.add(code);
    }
  } else if (isOmaniNationality(context.nationality)) {
    for (const code of rules.person_omani) codes.add(code);
  } else if ((context.nationality ?? '').trim()) {
    for (const code of rules.person_expat) codes.add(code);
  } else {
    // Unknown nationality: start with civil ID + passport so owner can trim.
    codes.add('civil_id');
    codes.add('passport');
  }
  return picksFromCodes([...codes], sale);
}

export function describeDocumentSuggestion(context: TenantDocumentContext, ar: boolean): string {
  if (context.entityType === 'company') {
    const signatory = context.signatoryNationality || context.nationality;
    if (!signatory?.trim()) {
      return ar
        ? 'اقتراح لشركة: مستندات الشركة + هوية المفوض (حدّد جنسية المفوض لتدقيق القائمة).'
        : 'Suggested for a company: company docs + signatory ID (set signatory nationality to refine).';
    }
    return isOmaniNationality(signatory)
      ? ar
        ? 'اقتراح لشركة ومفوّض عماني.'
        : 'Suggested for a company with an Omani signatory.'
      : ar
        ? 'اقتراح لشركة ومفوّض وافد.'
        : 'Suggested for a company with an expatriate signatory.';
  }
  if (!context.nationality?.trim()) {
    return ar
      ? 'حدّد الجنسية لاقتراح مستندات أدق (عماني / وافد).'
      : 'Set nationality for a sharper suggestion (Omani / expatriate).';
  }
  return isOmaniNationality(context.nationality)
    ? ar
      ? 'اقتراح لمستأجر شخصي عماني.'
      : 'Suggested for an Omani individual tenant.'
    : ar
      ? 'اقتراح لمستأجر شخصي وافد.'
      : 'Suggested for an expatriate individual tenant.';
}
