export const STAY_POLICY_SECTIONS = ['general', 'cancellation', 'events', 'payment'] as const;

export type StayPolicySectionKey = (typeof STAY_POLICY_SECTIONS)[number];

export type StayPolicySectionText = {
  ar?: string | null | undefined;
  en?: string | null | undefined;
};

export type StayPoliciesStructured = Partial<
  Record<StayPolicySectionKey, StayPolicySectionText | undefined>
>;

export type StayPoliciesJsonValue = string[] | StayPoliciesStructured;

export const STAY_POLICY_SECTION_LABELS: Record<
  StayPolicySectionKey,
  { ar: string; en: string }
> = {
  general: {
    ar: 'السياسات العامة لمكان الإقامة',
    en: 'General stay policies',
  },
  cancellation: {
    ar: 'سياسات الإلغاء والتغيير',
    en: 'Cancellation & change policies',
  },
  events: {
    ar: 'المناسبات والحفلات المسموح بها',
    en: 'Allowed events & parties',
  },
  payment: {
    ar: 'خيارات الدفع',
    en: 'Payment options',
  },
};

export function linesToPolicyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-–—*]+/, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

export function policyLinesToText(lines: string[] | undefined): string {
  return lines?.join('\n') ?? '';
}

export function isLegacyPoliciesJson(value: unknown): value is string[] {
  return Array.isArray(value);
}

export function isStructuredPoliciesJson(value: unknown): value is StayPoliciesStructured {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function parseStayPoliciesJson(
  raw: unknown,
  fallback?: { policiesAr?: string | null; policiesEn?: string | null },
): StayPoliciesStructured {
  if (isStructuredPoliciesJson(raw)) {
    return raw;
  }
  const generalLines = isLegacyPoliciesJson(raw) ? raw : [];
  const generalAr = generalLines.length
    ? generalLines.join('\n')
    : fallback?.policiesAr?.trim() ?? '';
  const generalEn = fallback?.policiesEn?.trim() ?? '';
  return {
    general: {
      ar: generalAr || null,
      en: generalEn || null,
    },
  };
}

export function buildStayPoliciesJson(sections: StayPoliciesStructured): StayPoliciesStructured {
  const result: StayPoliciesStructured = {};
  for (const key of STAY_POLICY_SECTIONS) {
    const section = sections[key];
    const ar = section?.ar?.trim() ?? '';
    const en = section?.en?.trim() ?? '';
    if (ar || en) {
      result[key] = {
        ar: ar || null,
        en: en || null,
      };
    }
  }
  return result;
}

export function resolvePolicySectionLines(
  sections: StayPoliciesStructured,
  key: StayPolicySectionKey,
  locale: string,
): string[] {
  const section = sections[key];
  const ar = locale === 'ar';
  const text = ar
    ? section?.ar?.trim() || section?.en?.trim()
    : section?.en?.trim() || section?.ar?.trim();
  return linesToPolicyLines(text ?? '');
}

export function resolveAllPolicySections(
  sections: StayPoliciesStructured,
  locale: string,
): Array<{ key: StayPolicySectionKey; title: string; lines: string[] }> {
  const ar = locale === 'ar';
  return STAY_POLICY_SECTIONS.map((key) => ({
    key,
    title: ar ? STAY_POLICY_SECTION_LABELS[key].ar : STAY_POLICY_SECTION_LABELS[key].en,
    lines: resolvePolicySectionLines(sections, key, locale),
  })).filter((item) => item.lines.length > 0);
}

export function resolveStayPoliciesFromDetail(
  detail: {
    policiesJson?: StayPoliciesJsonValue | null | undefined;
    policiesAr?: string | null | undefined;
    policiesEn?: string | null | undefined;
  },
  locale: string,
): Array<{ key: StayPolicySectionKey; title: string; lines: string[] }> {
  return resolveAllPolicySections(
    parseStayPoliciesJson(detail.policiesJson, {
      policiesAr: detail.policiesAr ?? null,
      policiesEn: detail.policiesEn ?? null,
    }),
    locale,
  );
}
