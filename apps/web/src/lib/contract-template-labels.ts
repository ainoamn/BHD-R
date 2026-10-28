/** Human labels for built-in contract template keys (avoid raw snake_case in UI). */

export const CONTRACT_TEMPLATE_LABELS: Record<string, { ar: string; en: string }> = {
  lease_default: { ar: 'عقد إيجار (افتراضي)', en: 'Lease (default)' },
  sale_default: { ar: 'عقد بيع (افتراضي)', en: 'Sale (default)' },
  stay_reschedule_amendment: {
    ar: 'ملحق تعديل تواريخ الإقامة',
    en: 'Stay date-change addendum',
  },
  stay_termination_addendum: {
    ar: 'ملحق إلغاء عقد الإقامة',
    en: 'Stay cancellation addendum',
  },
};

export function contractTemplateLabel(key: string, locale: 'ar' | 'en' | boolean): string {
  const ar = locale === true || locale === 'ar';
  const hit = CONTRACT_TEMPLATE_LABELS[key];
  if (hit) return ar ? hit.ar : hit.en;
  return key.replace(/[_-]+/g, ' ').trim() || key;
}

type TemplateOption = {
  id: string;
  key?: string | null;
  version?: number | string | null;
  language?: string | null;
  name?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
};

/** Lease / renewal pickers: exclude stay addenda and sale templates. */
export function leaseContractTemplateOptions<T extends TemplateOption>(
  options: readonly T[] | null | undefined,
  locale: 'ar' | 'en',
): Array<T & { name: string; nameAr: string; nameEn: string }> {
  const ar = locale === 'ar';
  return (options ?? [])
    .filter((row) => {
      const key = String(row.key ?? '');
      if (!key) return true;
      if (key.startsWith('stay_')) return false;
      if (key.startsWith('sale_')) return false;
      return true;
    })
    .map((row) => {
      const key = String(row.key ?? '');
      const base = contractTemplateLabel(key || 'lease_default', locale);
      const version = row.version != null ? ` v${row.version}` : '';
      const lang = row.language ? ` · ${String(row.language).toUpperCase()}` : '';
      const label = `${base}${version}${lang}`;
      return {
        ...row,
        name: label,
        nameAr: ar ? label : (row.nameAr ?? label),
        nameEn: ar ? (row.nameEn ?? label) : label,
      };
    });
}
