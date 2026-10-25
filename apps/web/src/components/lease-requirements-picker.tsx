'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LEASE_DOCUMENT_RULES,
  describeDocumentSuggestion,
  suggestLeaseDocuments,
  type DocumentRequirementPick,
  type LeaseDocumentRules,
  type TenantDocumentContext,
} from '@/lib/lease-document-rules';
import { REQUIREMENT_CATALOGUE } from '@/lib/lease-reservation-lifecycle';

function codesKey(items: DocumentRequirementPick[]): string {
  return items
    .map((item) => item.code)
    .sort()
    .join(',');
}

/**
 * Owner picks which uploads the client must provide. When tenant type / nationality changes,
 * a smart suggestion is applied until the owner customizes the list.
 */
export function LeaseRequirementsPicker({
  ar,
  sale,
  value,
  onChange,
  context,
  rules = DEFAULT_LEASE_DOCUMENT_RULES,
  /** When true, do not auto-replace an already saved list. */
  lockInitial = false,
}: {
  ar: boolean;
  sale: boolean;
  value: DocumentRequirementPick[];
  onChange: (next: DocumentRequirementPick[]) => void;
  context: TenantDocumentContext;
  rules?: LeaseDocumentRules;
  lockInitial?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const [manual, setManual] = useState(lockInitial && value.length > 0);
  const lastAutoKey = useRef(lockInitial ? codesKey(value) : '');
  const options = REQUIREMENT_CATALOGUE.filter((item) => (sale ? item.sale : item.rent));
  const chosen = new Set(value.map((item) => item.code));
  const customs = value.filter((item) => !options.some((option) => option.code === item.code));

  const suggestion = useMemo(
    () => suggestLeaseDocuments({ ...context, sale }, rules),
    [context, rules, sale],
  );
  const hint = describeDocumentSuggestion(context, ar);

  useEffect(() => {
    if (manual) return;
    const key = codesKey(suggestion);
    if (!key || key === lastAutoKey.current) return;
    const currentKey = codesKey(value);
    if (value.length > 0 && currentKey !== lastAutoKey.current) {
      setManual(true);
      return;
    }
    lastAutoKey.current = key;
    onChange(suggestion);
  }, [suggestion, manual, value, onChange]);

  function toggle(option: { code: string; labelAr: string; labelEn: string }) {
    setManual(true);
    onChange(
      chosen.has(option.code)
        ? value.filter((item) => item.code !== option.code)
        : [...value, { code: option.code, labelAr: option.labelAr, labelEn: option.labelEn }],
    );
  }

  function addCustom() {
    const label = custom.trim();
    if (label.length < 2 || value.length >= 12) return;
    setManual(true);
    let index = 1;
    while (chosen.has(`custom_${index}`)) index += 1;
    onChange([...value, { code: `custom_${index}`, labelAr: label, labelEn: label }]);
    setCustom('');
  }

  function applySuggestion() {
    const key = codesKey(suggestion);
    lastAutoKey.current = key;
    setManual(false);
    onChange(suggestion);
  }

  return (
    <fieldset className="lcf-section lrw__picker">
      <legend>{ar ? '📎 المستندات المطلوبة من العميل' : '📎 Documents to request'}</legend>
      <p className="muted">
        {ar
          ? 'يُقترح تلقائياً حسب نوع المستأجر والجنسية (أو جنسية المفوّض للشركة). يمكنك تعديل القائمة.'
          : 'Suggested from tenant type and nationality (or company signatory nationality). You can edit the list.'}
      </p>
      <p className="lrw__suggest-hint muted">{hint}</p>
      <div className="form-actions" style={{ marginBlock: '0.5rem' }}>
        <button type="button" className="button button--quiet" onClick={applySuggestion}>
          {ar ? 'تطبيق الاقتراح الذكي' : 'Apply smart suggestion'}
        </button>
      </div>
      <div className="lrw__chips">
        {options.map((option) => (
          <label key={option.code} className="lrw__chip">
            <input
              type="checkbox"
              checked={chosen.has(option.code)}
              onChange={() => toggle(option)}
            />
            <span>{ar ? option.labelAr : option.labelEn}</span>
          </label>
        ))}
        {customs.map((item) => (
          <label key={item.code} className="lrw__chip">
            <input
              type="checkbox"
              checked
              onChange={() => {
                setManual(true);
                onChange(value.filter((entry) => entry.code !== item.code));
              }}
            />
            <span>{item.labelAr}</span>
          </label>
        ))}
      </div>
      <div className="lrw__custom">
        <input
          className="input"
          value={custom}
          maxLength={120}
          placeholder={ar ? 'مستند آخر… (مثال: شهادة لا مانع)' : 'Another document…'}
          onChange={(event) => setCustom(event.target.value)}
        />
        <button type="button" className="button button--quiet" onClick={addCustom}>
          {ar ? 'إضافة' : 'Add'}
        </button>
      </div>
    </fieldset>
  );
}
