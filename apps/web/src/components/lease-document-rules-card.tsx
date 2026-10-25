'use client';

import { useMemo, useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  DEFAULT_LEASE_DOCUMENT_RULES,
  DOCUMENT_PROFILE_LABELS,
  type DocumentProfileKey,
  type LeaseDocumentRules,
} from '@/lib/lease-document-rules';
import { REQUIREMENT_CATALOGUE } from '@/lib/lease-reservation-lifecycle';

const PROFILE_KEYS = Object.keys(DEFAULT_LEASE_DOCUMENT_RULES) as DocumentProfileKey[];

function rulesEqual(a: LeaseDocumentRules, b: LeaseDocumentRules): boolean {
  return PROFILE_KEYS.every((key) => {
    const left = [...a[key]].sort().join(',');
    const right = [...b[key]].sort().join(',');
    return left === right;
  });
}

/**
 * Owner configures which documents each tenant profile must upload:
 * individual Omani / expatriate, company base docs, and signatory Omani / expatriate.
 */
export function LeaseDocumentRulesCard({
  locale,
  propertyId,
  initialRules,
  inherited,
}: {
  locale: 'ar' | 'en';
  propertyId: string | null;
  initialRules: LeaseDocumentRules | null;
  inherited: { source: 'property' | 'organization' | 'default'; rules: LeaseDocumentRules };
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const catalogue = useMemo(
    () => REQUIREMENT_CATALOGUE.filter((item) => item.rent),
    [],
  );
  const [saved, setSaved] = useState<LeaseDocumentRules | null>(initialRules);
  const [draft, setDraft] = useState<LeaseDocumentRules>(initialRules ?? inherited.rules);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const effective = saved ?? inherited.rules;
  const dirty = !rulesEqual(draft, effective) || !saved;
  const fallbackLabel = propertyId
    ? inherited.source === 'organization'
      ? t('قواعد المؤسسة', 'organization rules')
      : t('الإعداد الافتراضي', 'the default')
    : t('الإعداد الافتراضي', 'the default');

  async function save(rules: LeaseDocumentRules | null) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserNextMutation<{ rules: LeaseDocumentRules | null }>(
        '/api/owner/lease-document-rules',
        {
          method: 'PUT',
          body: JSON.stringify({ propertyId, rules }),
        },
      );
      setSaved(result.rules);
      setDraft(result.rules ?? inherited.rules);
      setMessage({
        ok: true,
        text: t('تم حفظ مستندات المستأجر المطلوبة.', 'Tenant document rules saved.'),
      });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setMessage({
        ok: false,
        text:
          code === 'forbidden'
            ? t('لا تملك صلاحية إدارة الحجوزات.', 'You cannot manage bookings.')
            : t('تعذّر الحفظ — أعد المحاولة.', 'Could not save — try again.'),
      });
    } finally {
      setBusy(false);
    }
  }

  function toggle(profile: DocumentProfileKey, code: string) {
    setDraft((current) => {
      const has = current[profile].includes(code);
      const next = has
        ? current[profile].filter((item) => item !== code)
        : [...current[profile], code].slice(0, 12);
      return { ...current, [profile]: next };
    });
  }

  return (
    <section className="approval-policy" aria-labelledby="lease-doc-rules-title">
      <header className="approval-policy__head">
        <div>
          <h2 id="lease-doc-rules-title">
            {propertyId
              ? t('مستندات المستأجر لهذا العقار', 'Tenant documents for this property')
              : t('مستندات المستأجر المطلوبة', 'Required tenant documents')}
          </h2>
          <p className="muted">
            {t(
              'حدّد ما يرفع المستأجر حسب نوعه: شخصي أو شركة، وعماني أو وافد، وللشركات مستندات المفوضين.',
              'Choose what tenants must upload by type: individual or company, Omani or expatriate, and company signatories.',
            )}
          </p>
        </div>
        <span className={`approval-policy__source${saved ? ' approval-policy__source--own' : ''}`}>
          {saved
            ? propertyId
              ? t('مخصّصة لهذا العقار', 'Custom for this property')
              : t('قواعد المؤسسة', 'Organization rules')
            : t(`تتبع ${fallbackLabel}`, `Follows ${fallbackLabel}`)}
        </span>
      </header>

      <div className="approval-policy__steps">
        {PROFILE_KEYS.map((profile) => {
          const [labelAr, labelEn] = DOCUMENT_PROFILE_LABELS[profile];
          const chosen = new Set(draft[profile]);
          return (
            <fieldset key={profile} className="approval-policy__step">
              <legend>{ar ? labelAr : labelEn}</legend>
              <div className="lrw__chips">
                {catalogue.map((option) => (
                  <label key={`${profile}-${option.code}`} className="lrw__chip">
                    <input
                      type="checkbox"
                      checked={chosen.has(option.code)}
                      onChange={() => toggle(profile, option.code)}
                    />
                    <span>{ar ? option.labelAr : option.labelEn}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      {message ? (
        <p className={`notice notice--${message.ok ? 'ok' : 'error'}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="approval-policy__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !dirty}
          onClick={() => void save(draft)}
        >
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => setDraft({ ...DEFAULT_LEASE_DOCUMENT_RULES })}
        >
          {t('استعادة الافتراضي', 'Restore defaults')}
        </button>
        {saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {propertyId
              ? t('إزالة تخصيص العقار', 'Clear property override')
              : t('إزالة قواعد المؤسسة', 'Clear organization rules')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
