'use client';

import { useMemo, useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  APPROVAL_STEPS,
  CONTRACT_APPROVAL_KINDS,
  DEFERRED_LEASE_FIELDS,
  DEFAULT_APPROVAL_POLICY_BY_KIND,
  FULL_AUTO_APPROVAL_POLICY,
  approvalStepHelp,
  approvalStepLabel,
  approvalStepsForKind,
  contractApprovalKindHint,
  contractApprovalKindLabel,
  deferredLeaseFieldLabel,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalPolicySource,
  type ContractApprovalKind,
  type DeferredLeaseField,
} from '@/lib/approval-policy';

export type ApprovalPolicyKindState = {
  kind: ContractApprovalKind;
  initialPolicy: ApprovalPolicy | null;
  delegateName: string | null;
  inherited: { source: ApprovalPolicySource; policy: ApprovalPolicy };
};

function policyEqual(a: ApprovalPolicy, b: ApprovalPolicy): boolean {
  if (APPROVAL_STEPS.some((step) => a[step] !== b[step])) return false;
  if (a.requireTenantAttestation !== b.requireTenantAttestation) return false;
  if (a.electronicSignature !== b.electronicSignature) return false;
  if (a.viewingAutoSchedule !== b.viewingAutoSchedule) return false;
  const left = [...a.deferUntilHandover].sort().join(',');
  const right = [...b.deferUntilHandover].sort().join(',');
  return left === right;
}

function KindEditor({
  locale,
  propertyId,
  state,
  onOverrideChange,
}: {
  locale: 'ar' | 'en';
  propertyId: string | null;
  state: ApprovalPolicyKindState;
  onOverrideChange?: ((kind: ContractApprovalKind, hasOwn: boolean) => void) | undefined;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const kind = state.kind;
  const [saved, setSaved] = useState<ApprovalPolicy | null>(state.initialPolicy);
  const [draft, setDraft] = useState<ApprovalPolicy>(state.initialPolicy ?? state.inherited.policy);
  const [signer, setSigner] = useState(state.delegateName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const effective = saved ?? state.inherited.policy;
  const dirty = !policyEqual(draft, effective) || !saved;
  const steps = approvalStepsForKind(kind);
  const fallbackLabel =
    state.inherited.source === 'organization'
      ? t('سياسة المؤسسة', 'the organization policy')
      : state.inherited.source === 'legacy'
        ? t('السياسة السابقة المشتركة', 'the previous shared policy')
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
        body: JSON.stringify({ propertyId, kind, policy }),
      });
      setSaved(result.policy);
      setDraft(result.policy ?? state.inherited.policy);
      setSigner(result.delegateName);
      onOverrideChange?.(kind, result.policy != null);
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
              ? t(
                  'لا تملك صلاحية إدارة هذا النوع من العقود.',
                  'You cannot manage this contract type.',
                )
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

  const anyAuto = steps.some((step) => draft[step] === 'auto');

  return (
    <div className="approval-policy__kind">
      <p className="muted">{contractApprovalKindHint(kind, ar)}</p>

      <div className="approval-policy__actions approval-policy__actions--top">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => setDraft({ ...FULL_AUTO_APPROVAL_POLICY })}
        >
          {t('تفعيل المسار الإلكتروني الكامل', 'Enable full electronic path')}
        </button>
        <span className={`approval-policy__source${saved ? ' approval-policy__source--own' : ''}`}>
          {saved
            ? propertyId
              ? t('مخصّصة لهذا العقار', 'Custom for this property')
              : t('سياسة المؤسسة', 'Organization policy')
            : t(`تتبع ${fallbackLabel}`, `Follows ${fallbackLabel}`)}
        </span>
      </div>

      <div className="approval-policy__steps">
        {steps.map((step) => (
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
                    name={`approval-${propertyId ?? 'org'}-${kind}-${step}`}
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
        <legend>{t('التوقيع الإلكتروني', 'Electronic signature')}</legend>
        <label
          className={`approval-policy__option${
            draft.electronicSignature ? ' approval-policy__option--on' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={draft.electronicSignature}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                electronicSignature: event.target.checked,
              }))
            }
          />
          <span>
            <strong>
              {t(
                'إلزام العميل بالتوقيع الإلكتروني لهذا النوع',
                'Require the customer’s electronic signature for this type',
              )}
            </strong>
            <small>
              {t(
                'عند الإيقاف يمكن إكمال المسار دون توقيع إلكتروني من العميل (يبقى اعتمادك أنت كما ضبطته أعلاه).',
                'When off, the flow may continue without the customer’s e-sign (your own approvals still follow the steps above).',
              )}
            </small>
          </span>
        </label>
      </fieldset>

      {kind !== 'daily' ? (
        <fieldset className="approval-policy__step">
          <legend>{t('أتمتة مواعيد المعاينة', 'Viewing appointment automation')}</legend>
          <label
            className={`approval-policy__option${
              draft.viewingAutoSchedule ? ' approval-policy__option--on' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={draft.viewingAutoSchedule}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  viewingAutoSchedule: event.target.checked,
                }))
              }
            />
            <span>
              <strong>
                {t(
                  'تأكيد الموعد تلقائياً عند استلام الطلب',
                  'Confirm the preferred time automatically when a request arrives',
                )}
              </strong>
              <small>
                {t(
                  'إن اختار الزائر وقتاً مفضّلاً يعتمد النظام الموعد ويرسله للمالك والموظف والحارس. أوقف الخيار للجدولة اليدوية من مكتب المعاينات.',
                  'If the visitor picks a preferred time, the system confirms it and notifies the owner, staff, and guard. Turn off for manual scheduling from the viewing desk.',
                )}
              </small>
            </span>
          </label>
        </fieldset>
      ) : null}

      {kind === 'rent' ? (
        <>
          <fieldset className="approval-policy__step">
            <legend>
              {t(
                'حقول تُؤجَّل لما بعد توقيع المستأجر وقبل التسليم',
                'Fields deferred until after tenant sign, before handover',
              )}
            </legend>
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
              </span>
            </label>
          </fieldset>
        </>
      ) : null}

      {draft.contract === 'auto' ? (
        <p className="notice notice--info">
          {signer && saved?.contract === 'auto'
            ? t(
                `يوقَّع العقد تلقائياً باسم ${signer} الذي فعّل هذه السياسة.`,
                `Contracts are signed automatically in the name of ${signer}, who enabled this policy.`,
              )
            : t(
                'يوقَّع العقد تلقائياً باسمك أنت عند الحفظ.',
                'Contracts will be signed automatically in your name.',
              )}
        </p>
      ) : null}

      {anyAuto ? (
        <div className="approval-policy__preview">
          <strong>{t('ما يراه العميل عند الاعتماد الإلكتروني', 'What the client sees')}</strong>
          <p>
            {t(
              'تنبيه: تم الاعتماد إلكترونياً؛ قد تُراجع المستندات يدوياً قبل التسليم.',
              'Notice: approved electronically; documents may still be reviewed manually before handover.',
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
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ سياسة هذا النوع', 'Save this type’s policy')}
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
    </div>
  );
}

/**
 * Three contract kinds — daily rental, long-term lease, purchase — each with its own
 * booking approval, e-contract, e-sign, and (for rent/sale) viewing automation.
 */
export function ApprovalPolicyCard({
  locale,
  propertyId,
  kinds,
  onOverrideChange,
}: {
  locale: 'ar' | 'en';
  propertyId: string | null;
  kinds: ApprovalPolicyKindState[];
  /** Fired after save/clear so parent lists can show custom vs inherited. */
  onOverrideChange?: ((kind: ContractApprovalKind, hasOwn: boolean) => void) | undefined;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const ordered = useMemo(() => {
    const map = new Map(kinds.map((row) => [row.kind, row]));
    return CONTRACT_APPROVAL_KINDS.map(
      (kind) =>
        map.get(kind) ?? {
          kind,
          initialPolicy: null,
          delegateName: null,
          inherited: {
            source: 'default' as const,
            policy: DEFAULT_APPROVAL_POLICY_BY_KIND[kind],
          },
        },
    );
  }, [kinds]);
  const [active, setActive] = useState<ContractApprovalKind>('rent');

  return (
    <section className="approval-policy" aria-labelledby="approval-policy-title">
      <header className="approval-policy__head">
        <div>
          <h2 id="approval-policy-title">
            {propertyId
              ? t('إعدادات خاصة لهذا المبنى', 'Custom settings for this building')
              : t('إعدادات عامة — كل المباني', 'General settings — all buildings')}
          </h2>
          <p className="muted">
            {propertyId
              ? t(
                  'هذه القيم تتجاوز الإعدادات العامة لهذا المبنى فقط. احفظ نوع العقد الذي تغيّره، أو ارجع للإعدادات العامة من زر «العودة».',
                  'These values override the general settings for this building only. Save each contract type you change, or return to the general settings with “Use …”.',
                )
              : t(
                  'تطبَّق على كل المباني ما لم تخصّص مبنىً أدناه. لكل نوع عقد (يومي، طويل الأجل، شراء): اعتماد الحجز، العقد، التوقيع الإلكتروني، وأتمتة المعاينة حيث تنطبق.',
                  'Applies to every building unless you customize one below. Each contract type (daily, long-term, purchase) has booking approval, contract, e-signature, and viewing automation where it applies.',
                )}
          </p>
        </div>
      </header>

      <div
        className="approval-policy__tabs"
        role="tablist"
        aria-label={t('نوع العقد', 'Contract type')}
      >
        {ordered.map((row) => (
          <button
            key={row.kind}
            type="button"
            role="tab"
            aria-selected={active === row.kind}
            className={`button ${active === row.kind ? 'button--primary' : 'button--quiet'}`}
            onClick={() => setActive(row.kind)}
          >
            {contractApprovalKindLabel(row.kind, ar)}
          </button>
        ))}
      </div>

      {ordered.map((row) =>
        row.kind === active ? (
          <KindEditor
            key={row.kind}
            locale={locale}
            propertyId={propertyId}
            state={row}
            onOverrideChange={onOverrideChange}
          />
        ) : null,
      )}
    </section>
  );
}
