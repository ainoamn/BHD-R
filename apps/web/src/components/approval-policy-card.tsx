'use client';

import { useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  APPROVAL_STEPS,
  DEFERRED_LEASE_FIELDS,
  FULL_AUTO_APPROVAL_POLICY,
  approvalStepHelp,
  approvalStepLabel,
  deferredLeaseFieldLabel,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalPolicySource,
  type DeferredLeaseField,
} from '@/lib/approval-policy';

function policyEqual(a: ApprovalPolicy, b: ApprovalPolicy): boolean {
  if (APPROVAL_STEPS.some((step) => a[step] !== b[step])) return false;
  if (a.requireTenantAttestation !== b.requireTenantAttestation) return false;
  const left = [...a.deferUntilHandover].sort().join(',');
  const right = [...b.deferUntilHandover].sort().join(',');
  return left === right;
}

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
  const dirty = !policyEqual(draft, effective) || !saved;
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

  const set = (step: (typeof APPROVAL_STEPS)[number], mode: ApprovalMode) =>
    setDraft((current) => ({ ...current, [step]: mode }));

  const toggleDefer = (field: DeferredLeaseField) => {
    setDraft((current) => {
      const has = current.deferUntilHandover.includes(field);
      return {
        ...current,
        deferUntilHandover: has
          ? current.deferUntilHandover.filter((item) => item !== field)
          : [...current.deferUntilHandover, field],
      };
    });
  };

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
                  'اضبط كل خطوات الاعتماد مرة واحدة لهذا العقار: حجز، عقد، دفع، تعديلات، حقول مؤجّلة، وإقرار المستأجر.',
                  'Configure every approval step once for this property: booking, contract, payment, changes, deferred fields, and tenant attestation.',
                )
              : t(
                  'اضبط كل خطوات الاعتماد مرة واحدة لكل عقاراتك (حجز، عقد إلكتروني، دفع، تعديلات). يمكن تخصيص أي عقار من صفحة شروطه.',
                  'Configure every approval step once for all your properties (booking, e-contract, payment, changes). Any property can override from its terms page.',
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

      <div className="approval-policy__actions approval-policy__actions--top">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => setDraft({ ...FULL_AUTO_APPROVAL_POLICY })}
        >
          {t('تفعيل المسار الإلكتروني الكامل', 'Enable full electronic path')}
        </button>
      </div>

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

      <fieldset className="approval-policy__step">
        <legend>
          {t(
            'حقول تُؤجَّل لما بعد توقيع المستأجر وقبل التسليم',
            'Fields deferred until after tenant sign, before handover',
          )}
        </legend>
        <p className="muted">
          {t(
            'عند تفعيلها يمكن تركها فارغة أثناء إعداد العقد؛ تُستكمل عند التسليم. يسهّل الاعتماد الإلكتروني دون انتظار كل التفاصيل.',
            'When enabled they may stay empty while preparing the contract and are completed at handover — smoother electronic approval.',
          )}
        </p>
        <div className="approval-policy__options">
          {DEFERRED_LEASE_FIELDS.map((field) => (
            <label
              key={field}
              className={`approval-policy__option${
                draft.deferUntilHandover.includes(field) ? ' approval-policy__option--on' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={draft.deferUntilHandover.includes(field)}
                onChange={() => toggleDefer(field)}
              />
              <span>
                <strong>{deferredLeaseFieldLabel(field, ar)}</strong>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="approval-policy__step">
        <legend>
          {t('إقرار المستأجر بصحة البيانات', 'Tenant attestation of accurate data')}
        </legend>
        <label
          className={`approval-policy__option${
            draft.requireTenantAttestation ? ' approval-policy__option--on' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={draft.requireTenantAttestation}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                requireTenantAttestation: event.target.checked,
              }))
            }
          />
          <span>
            <strong>
              {t(
                'إلزام المستأجر بالتأكيد قبل رفع المستندات أو توقيع العقد',
                'Require tenant confirmation before uploads or contract signature',
              )}
            </strong>
            <small>
              {t(
                'يؤكد أن بياناته ومستنداته صحيحة، ويعلم أن المراجعة اليدوية تتم قبل التسليم، وأن للمالك إلغاء الحجز عند الاختلاف مع تحمّل المستأجر المسؤولية.',
                'They confirm details/docs are accurate, know manual review happens before handover, and that the owner may cancel if invalid — tenant bears responsibility.',
              )}
            </small>
          </span>
        </label>
      </fieldset>

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
              'تنبيه: تم الاعتماد إلكترونياً؛ سيراجع الفريق المستندات يدوياً قبل التسليم. إن وُجد اختلاف أو عدم صحة يحق للمالك إلغاء الحجز والطلب ويتحمّل المستأجر كامل المسؤولية — لذلك يُطلب منه التأكيد قبل المتابعة.',
              'Notice: approved electronically; the team will manually review documents before handover. If anything is wrong or mismatched, the owner may cancel the booking and the tenant bears full responsibility — so confirmation is required before continuing.',
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
