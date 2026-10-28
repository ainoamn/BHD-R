'use client';

import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  DEFAULT_LEASE_RENEWAL_AUTOMATION,
  RENEWAL_TERM_PRESETS,
  type LeaseRenewalAutomationPolicy,
} from '@/lib/lease-renewal-automation';

export function LeaseRenewalAutomationCard({
  locale,
  initialPolicy,
}: {
  locale: 'ar' | 'en';
  initialPolicy: LeaseRenewalAutomationPolicy | null;
}) {
  const ar = locale === 'ar';
  const t = (a: string, e: string) => (ar ? a : e);
  const [draft, setDraft] = useState<LeaseRenewalAutomationPolicy>(
    initialPolicy ?? DEFAULT_LEASE_RENEWAL_AUTOMATION,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserNextMutation<{ policy: LeaseRenewalAutomationPolicy }>(
        '/api/owner/lease-renewal-automation',
        { method: 'PUT', body: JSON.stringify({ policy: draft }) },
      );
      setDraft(result.policy);
      setMessage({
        ok: true,
        text: t('تم حفظ إعدادات التجديد الإلكتروني.', 'Electronic renewal settings saved.'),
      });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setMessage({
        ok: false,
        text:
          code === 'forbidden'
            ? t('ليست لديك صلاحية تعديل التأجير.', 'You cannot change leasing settings.')
            : t('تعذّر الحفظ — أعد المحاولة.', 'Could not save — try again.'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="approval-policy" aria-labelledby="renewal-auto-title">
      <header className="approval-policy__head">
        <div>
          <p className="ops-kicker">{t('التوثيق الإلكتروني', 'E-documentation')}</p>
          <h2 id="renewal-auto-title">{t('تجديد العقود تلقائياً', 'Automatic lease renewals')}</h2>
          <p className="muted">
            {t(
              'قبل انتهاء العقد بالأيام التي تحددها، يُنشئ النظام ملحق تجديد بنفس البيانات السابقة ويرسله للمستأجر للتوقيع والمستندات والشيكات — بلا تدخل يدوي. يمكنك أيضاً ضبط كل عقد من صفحته.',
              'Before a lease ends (by the lead days you set), the system creates a renewal addendum from the previous terms and sends it to the tenant for e-sign, documents, and cheques — with no manual step. You can also override this per contract.',
            )}
          </p>
        </div>
      </header>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
        />
        {t('تفعيل التجديد الإلكتروني التلقائي لكل العقود', 'Enable automatic electronic renewal for all leases')}
      </label>

      <div className="form-grid" style={{ marginTop: '1rem' }}>
        <label className="field">
          <span>{t('الإرسال قبل الانتهاء (أيام)', 'Send before end (days)')}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={365}
            value={draft.leadDays}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                leadDays: Number(event.target.value) || 0,
              }))
            }
          />
          <span className="muted">
            {t(
              'الافتراضي 90 يوماً (≈ 3 أشهر). إن بقي أقل من ذلك يُرسل فوراً.',
              'Default 90 days (~3 months). If less remains, it is sent immediately.',
            )}
          </span>
        </label>

        <label className="field">
          <span>{t('مدة التجديد الافتراضية', 'Default renewal term')}</span>
          <select
            className="select"
            value={draft.termMonths === null ? 'same' : String(draft.termMonths)}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({
                ...current,
                termMonths: value === 'same' ? null : Number(value),
              }));
            }}
          >
            <option value="same">{t('نفس مدة العقد الحالي', 'Same as current lease')}</option>
            {RENEWAL_TERM_PRESETS.map((months) => (
              <option key={months} value={months}>
                {months === 1
                  ? t('شهر واحد', '1 month')
                  : months === 12
                    ? t('سنة واحدة', '1 year')
                    : t(`${months} أشهر`, `${months} months`)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('أقل مدة يقبلها النظام (أشهر)', 'Minimum accepted term (months)')}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={120}
            value={draft.minTermMonths}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                minTermMonths: Math.max(1, Number(event.target.value) || 1),
              }))
            }
          />
        </label>
      </div>

      <label className="checkbox-row" style={{ marginTop: '0.75rem' }}>
        <input
          type="checkbox"
          checked={draft.autoApproveShorterTerm}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              autoApproveShorterTerm: event.target.checked,
            }))
          }
        />
        {t(
          'موافقة تلقائية إذا قصّر المستأجر المدة (مع احترام الحد الأدنى)',
          'Auto-approve when the tenant shortens the term (still respecting the minimum)',
        )}
      </label>

      {message ? (
        <div
          className={`notice ${message.ok ? 'notice--info' : 'notice--danger'}`}
          role={message.ok ? 'status' : 'alert'}
          style={{ marginTop: '1rem' }}
        >
          {message.text}
        </div>
      ) : null}

      <div style={{ marginTop: '1rem' }}>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? t('جاري الحفظ…', 'Saving…') : t('حفظ إعدادات التجديد', 'Save renewal settings')}
        </Button>
      </div>
    </section>
  );
}
