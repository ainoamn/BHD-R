'use client';

import { useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  APPROVAL_STEPS,
  approvalStepHelp,
  approvalStepLabel,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalPolicySource,
} from '@/lib/approval-policy';

/**
 * Owner chooses, step by step, whether website bookings wait for them or the system approves
 * on their behalf — for the whole organization, or overriding it for one property.
 */
export function ApprovalPolicyCard({
  locale,
  propertyId,
  initialPolicy,
  delegateName,
  inherited,
}: {
  locale: 'ar' | 'en';
  propertyId: string | null;
  /** The policy saved at this level; null when it inherits. */
  initialPolicy: ApprovalPolicy | null;
  delegateName: string | null;
  /** What applies without an override: the organization policy for a property, else the default. */
  inherited: { source: ApprovalPolicySource; policy: ApprovalPolicy };
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [saved, setSaved] = useState<ApprovalPolicy | null>(initialPolicy);
  const [draft, setDraft] = useState<ApprovalPolicy>(initialPolicy ?? inherited.policy);
  const [signer, setSigner] = useState(delegateName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const effective = saved ?? inherited.policy;
  const dirty = APPROVAL_STEPS.some((step) => draft[step] !== effective[step]) || !saved;
  const fallbackLabel = propertyId
    ? inherited.source === 'organization'
      ? t('سياسة المؤسسة', 'the organization policy')
      : t('الإعداد الافتراضي', 'the default')
    : t('الإعداد الافتراضي', 'the default');

  async function save(policy: ApprovalPolicy | null) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserNextMutation<{
        policy: ApprovalPolicy | null;
        delegateName: string | null;
      }>('/api/owner/approval-policy', {
        method: 'PUT',
        body: JSON.stringify({ propertyId, policy }),
      });
      setSaved(result.policy);
      setDraft(result.policy ?? inherited.policy);
      setSigner(result.delegateName);
      setMessage({ ok: true, text: t('تم حفظ سياسة الاعتماد.', 'Approval policy saved.') });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setMessage({
        ok: false,
        text:
          code === 'approval_delegate_forbidden'
            ? t(
                'الاعتماد التلقائي للعقد يوقّع العقد باسم من يفعّله، لذا يلزمك صلاحية إنشاء العقود وتوقيعها.',
                'Automatic contract approval signs in the name of whoever enables it — you need contract signing rights.',
              )
            : code === 'forbidden'
              ? t('لا تملك صلاحية إدارة الحجوزات.', 'You cannot manage bookings.')
              : t('تعذّر الحفظ — أعد المحاولة.', 'Could not save — try again.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const set = (step: keyof ApprovalPolicy, mode: ApprovalMode) =>
    setDraft((current) => ({ ...current, [step]: mode }));
  const anyAuto = APPROVAL_STEPS.some((step) => draft[step] === 'auto');

  return (
    <section className="approval-policy" aria-labelledby="approval-policy-title">
      <header className="approval-policy__head">
        <div>
          <h2 id="approval-policy-title">
            {propertyId
              ? t('سياسة اعتماد حجوزات هذا العقار', 'Booking approvals for this property')
              : t('سياسة اعتماد الحجوزات والتعديلات', 'Booking and change approval policy')}
          </h2>
          <p className="muted">
            {propertyId
              ? t(
                  'حدّد لكل مرحلة — بما فيها تعديل تواريخ الإقامة — هل تعتمدها بنفسك أو يعتمدها النظام نيابةً عنك. بدون تخصيص يتبع العقار سياسة المؤسسة.',
                  'Choose for each step — including stay date changes — whether you approve it or the system does for you. Without an override the property follows the organization policy.',
                )
              : t(
                  'تنطبق على حجوزات الإيجار والشراء وتعديل تواريخ الإقامات اليومية من الموقع في كل عقاراتك. يمكن تخصيصها لأي عقار من صفحة شروطه.',
                  'Applies to website rent/purchase bookings and daily-stay date changes on all your properties; any property can override it from its terms page.',
                )}
          </p>
        </div>
        <span className={`approval-policy__source${saved ? ' approval-policy__source--own' : ''}`}>
          {saved
            ? propertyId
              ? t('مخصّصة لهذا العقار', 'Custom for this property')
              : t('سياسة المؤسسة', 'Organization policy')
            : t(`تتبع ${fallbackLabel}`, `Follows ${fallbackLabel}`)}
        </span>
      </header>

      <div className="approval-policy__steps">
        {APPROVAL_STEPS.map((step) => (
          <fieldset key={step} className="approval-policy__step">
            <legend>{approvalStepLabel(step, ar)}</legend>
            <div className="approval-policy__options">
              {(['manual', 'auto'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`approval-policy__option${draft[step] === mode ? ' approval-policy__option--on' : ''}`}
                >
                  <input
                    type="radio"
                    name={`approval-${propertyId ?? 'org'}-${step}`}
                    checked={draft[step] === mode}
                    onChange={() => set(step, mode)}
                  />
                  <span>
                    <strong>
                      {mode === 'auto'
                        ? t(
                            'تلقائي — يعتمده النظام نيابةً عني',
                            'Automatic — the system approves for me',
                          )
                        : t('يدوي — أعتمده بنفسي', 'Manual — I approve it')}
                    </strong>
                    <small>{approvalStepHelp(step, mode, ar)}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {draft.contract === 'auto' ? (
        <p className="notice notice--info">
          {signer && saved?.contract === 'auto'
            ? t(
                `يوقَّع العقد تلقائياً باسم ${signer} الذي فعّل هذه السياسة. إن فقد صلاحية التوقيع يعود الاعتماد يدوياً.`,
                `Contracts are signed automatically in the name of ${signer}, who enabled this policy. If they lose signing rights, approval goes back to manual.`,
              )
            : t(
                'يوقَّع العقد تلقائياً باسمك أنت عند الحفظ. إن فقدت صلاحية التوقيع يعود الاعتماد يدوياً.',
                'Contracts will be signed automatically in your name. If you lose signing rights, approval goes back to manual.',
              )}
        </p>
      ) : null}

      {anyAuto ? (
        <div className="approval-policy__preview">
          <strong>{t('ما يراه العميل عند الاعتماد الإلكتروني', 'What the client sees')}</strong>
          <p>
            {t(
              'تم اعتماد هذا الطلب إلكترونياً من النظام، وسيقوم الفريق بالتحقق من المستندات. في حال تبيّن أن المستندات تخالف الاشتراطات أو غير ملائمة يُعتبر الحجز ملغياً مباشرة، لذا يرجى التأكد من رفع المستندات الصحيحة.',
              'This request was approved electronically by the system, and the team will verify the documents. If they turn out to break the requirements or to be unsuitable, the booking is cancelled immediately — please make sure you upload the correct documents.',
            )}
          </p>
        </div>
      ) : null}

      <div className="approval-policy__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !dirty}
          onClick={() => void save(draft)}
        >
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ السياسة', 'Save policy')}
        </button>
        {saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {t(`العودة إلى ${fallbackLabel}`, `Use ${fallbackLabel}`)}
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={message.ok ? 'notice notice--success' : 'notice notice--error'} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
