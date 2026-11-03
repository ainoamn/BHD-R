'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  APPROVAL_STEPS,
  CONTRACT_APPROVAL_KINDS,
  DEFERRED_LEASE_FIELDS,
  DEFAULT_APPROVAL_POLICY_BY_KIND,
  FULL_AUTO_APPROVAL_POLICY,
  HANDOVER_AFTER_SIGN_OPTIONS,
  approvalStepHelp,
  approvalStepLabel,
  approvalStepsForKind,
  contractApprovalKindHint,
  contractApprovalKindLabel,
  deferredLeaseFieldLabel,
  handoverAfterSignLabel,
  rentAutoContractReady,
  type ApprovalMode,
  type ApprovalPolicy,
  type ApprovalPolicySource,
  type ContractApprovalKind,
  type DeferredLeaseField,
  type HandoverAfterSign,
  type RentAutoContractPrerequisites,
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
  if (a.allowHandoverBeforeDocVerify !== b.allowHandoverBeforeDocVerify) return false;
  if (a.electronicSignature !== b.electronicSignature) return false;
  if (a.viewingAutoSchedule !== b.viewingAutoSchedule) return false;
  if (a.handoverAfterSign !== b.handoverAfterSign) return false;
  const left = [...a.deferUntilHandover].sort().join(',');
  const right = [...b.deferUntilHandover].sort().join(',');
  return left === right;
}

function KindEditor({
  locale,
  portal,
  propertyId,
  state,
  rentPrerequisites,
  onOverrideChange,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  propertyId: string | null;
  state: ApprovalPolicyKindState;
  rentPrerequisites: RentAutoContractPrerequisites | null;
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
  const rentAutoReady = kind !== 'rent' || rentAutoContractReady(rentPrerequisites);
  const fallbackLabel =
    state.inherited.source === 'organization'
      ? t('سياسة المؤسسة', 'the organization policy')
      : state.inherited.source === 'legacy'
        ? t('السياسة السابقة المشتركة', 'the previous shared policy')
        : t('الإعداد الافتراضي', 'the default');

  async function save(policy: ApprovalPolicy | null) {
    if (policy?.contract === 'auto' && !rentAutoReady) {
      setMessage({
        ok: false,
        text: t(
          'أكمل الحساب البنكي ورقم الحارس أو مسؤول التسليم أولاً، ثم فعّل اعتماد العقد تلقائياً.',
          'Complete the bank account and the guard or handover phone first, then enable automatic contract approval.',
        ),
      });
      return;
    }
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
            : code === 'approval_bank_required'
              ? t(
                  'أكمل بيانات الحساب البنكي المطلوب (بنك، المستفيد، والآيبان أو رقم الحساب) في المحاسبة قبل تفعيل اعتماد العقد تلقائياً.',
                  'Complete the required bank account (bank, payee, and IBAN or account number) in accounting before enabling automatic contract approval.',
                )
              : code === 'approval_handover_contact_required'
                ? t(
                    'عيّن الحارس أو مسؤول التسليم مع رقم هاتفه في صفحة العقار قبل تفعيل اعتماد العقد تلقائياً.',
                    'Set the guard or handover contact with their phone on the property page before enabling automatic contract approval.',
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

  const set = (step: (typeof APPROVAL_STEPS)[number], mode: ApprovalMode) => {
    if (step === 'contract' && mode === 'auto' && !rentAutoReady) {
      setMessage({
        ok: false,
        text: t(
          'أكمل الحساب البنكي ورقم الحارس أو مسؤول التسليم أولاً، ثم فعّل اعتماد العقد تلقائياً.',
          'Complete the bank account and the guard or handover phone first, then enable automatic contract approval.',
        ),
      });
      return;
    }
    setDraft((current) => ({ ...current, [step]: mode }));
  };

  const toggleDefer = (field: DeferredLeaseField) => {
    setDraft((current) => {
      if (field === 'handoverOn' && current.handoverAfterSign) return current;
      const has = current.deferUntilHandover.includes(field);
      return {
        ...current,
        deferUntilHandover: has
          ? current.deferUntilHandover.filter((item) => item !== field)
          : [...current.deferUntilHandover, field],
      };
    });
  };

  const setHandoverAfterSign = (value: HandoverAfterSign | null) => {
    setDraft((current) => ({
      ...current,
      handoverAfterSign: value,
      deferUntilHandover: value
        ? current.deferUntilHandover.filter((item) => item !== 'handoverOn')
        : current.deferUntilHandover,
    }));
  };

  const enableFullElectronic = () => {
    if (!rentAutoReady && kind === 'rent') {
      setDraft({ ...FULL_AUTO_APPROVAL_POLICY, contract: 'manual' });
      setMessage({
        ok: false,
        text: t(
          'تم تفعيل المسار الإلكتروني مع إبقاء اعتماد العقد يدوياً حتى تُكمل الحساب البنكي ورقم مسؤول التسليم.',
          'Electronic path enabled with contract approval kept manual until the bank account and handover contact phone are complete.',
        ),
      });
      return;
    }
    setDraft({ ...FULL_AUTO_APPROVAL_POLICY });
  };

  const anyAuto = steps.some((step) => draft[step] === 'auto');
  const accountingHref = `/${portal}/accounting`;
  const handoverHref = propertyId
    ? `/${portal}/properties/${propertyId}#viewing-contact`
    : `/${portal}/properties`;

  return (
    <div className="approval-policy__kind">
      <p className="muted">{contractApprovalKindHint(kind, ar)}</p>

      {kind === 'rent' && rentPrerequisites ? (
        <div
          className={`notice ${rentAutoReady ? 'notice--success' : 'notice--info'}`}
          role="status"
        >
          <strong>
            {t(
              'قبل اعتماد العقد تلقائياً أكمل الآتي:',
              'Before automatic contract approval, complete:',
            )}
          </strong>
          <ul style={{ margin: '0.5rem 0 0', paddingInlineStart: '1.25rem' }}>
            <li>
              {rentPrerequisites.bankReady
                ? t('✓ الحساب البنكي المطلوب مكتمل', '✓ Required bank account is complete')
                : t(
                    '○ أضف حساباً بنكياً للإيجار (اسم البنك، المستفيد، والآيبان أو رقم الحساب)',
                    '○ Add a rent bank account (bank name, payee, and IBAN or account number)',
                  )}{' '}
              {!rentPrerequisites.bankReady ? (
                <Link href={accountingHref}>{t('المحاسبة', 'Accounting')}</Link>
              ) : null}
            </li>
            <li>
              {rentPrerequisites.handoverContactReady
                ? t(
                    '✓ رقم الحارس أو مسؤول التسليم محفوظ',
                    '✓ Guard or handover contact phone is saved',
                  )
                : t(
                    '○ عيّن الحارس أو مسؤول التسليم مع رقم هاتفه',
                    '○ Assign the guard or handover contact with their phone number',
                  )}{' '}
              {!rentPrerequisites.handoverContactReady ? (
                <Link href={handoverHref}>
                  {propertyId
                    ? t('صفحة العقار', 'Property page')
                    : t('العقارات', 'Properties')}
                </Link>
              ) : null}
            </li>
          </ul>
          {!rentPrerequisites.handoverContactReady &&
          rentPrerequisites.missingHandoverProperties.length > 0 &&
          !propertyId ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              {t('ينقص في:', 'Missing on:')}{' '}
              {rentPrerequisites.missingHandoverProperties
                .slice(0, 5)
                .map((row) => (ar ? row.nameAr : row.nameEn))
                .join(' · ')}
              {rentPrerequisites.missingHandoverProperties.length > 5
                ? ` (+${rentPrerequisites.missingHandoverProperties.length - 5})`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="approval-policy__actions approval-policy__actions--top">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={enableFullElectronic}
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
              {(['manual', 'auto'] as const).map((mode) => {
                const contractAutoLocked = step === 'contract' && mode === 'auto' && !rentAutoReady;
                return (
                  <label
                    key={mode}
                    className={`approval-policy__option${draft[step] === mode ? ' approval-policy__option--on' : ''}${
                      contractAutoLocked ? ' approval-policy__option--locked' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name={`approval-${propertyId ?? 'org'}-${kind}-${step}`}
                      checked={draft[step] === mode}
                      disabled={contractAutoLocked}
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
                      <small>
                        {contractAutoLocked
                          ? t(
                              'أكمل الحساب البنكي ورقم الحارس أو مسؤول التسليم أولاً.',
                              'Complete the bank account and the guard or handover phone first.',
                            )
                          : approvalStepHelp(step, mode, ar)}
                      </small>
                    </span>
                  </label>
                );
              })}
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
                'موعد التسليم بعد اعتماد العقد',
                'Handover date after contract approval',
              )}
            </legend>
            <p className="muted" style={{ marginTop: 0 }}>
              {t(
                'يُحسب تاريخ التسليم وبداية العقد تلقائياً ويظهر في العقد. المستندات والشيكات تُطلب من المستأجر مباشرة بعد توقيعه.',
                'Handover and lease start are calculated automatically and shown in the contract. Documents and cheques are requested right after the tenant signs.',
              )}
            </p>
            <div className="approval-policy__options">
              <label
                className={`approval-policy__option${
                  draft.handoverAfterSign === null ? ' approval-policy__option--on' : ''
                }`}
              >
                <input
                  type="radio"
                  name={`handover-after-${kind}`}
                  checked={draft.handoverAfterSign === null}
                  onChange={() => setHandoverAfterSign(null)}
                />
                <span>
                  <strong>{handoverAfterSignLabel(null, ar)}</strong>
                </span>
              </label>
              {HANDOVER_AFTER_SIGN_OPTIONS.map((option) => (
                <label
                  key={option}
                  className={`approval-policy__option${
                    draft.handoverAfterSign === option ? ' approval-policy__option--on' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name={`handover-after-${kind}`}
                    checked={draft.handoverAfterSign === option}
                    onChange={() => setHandoverAfterSign(option)}
                  />
                  <span>
                    <strong>{handoverAfterSignLabel(option, ar)}</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

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
                  }${field === 'handoverOn' && draft.handoverAfterSign ? ' approval-policy__option--disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={draft.deferUntilHandover.includes(field)}
                    disabled={field === 'handoverOn' && Boolean(draft.handoverAfterSign)}
                    onChange={() => toggleDefer(field)}
                  />
                  <span>
                    <strong>{deferredLeaseFieldLabel(field, ar)}</strong>
                    {field === 'handoverOn' && draft.handoverAfterSign ? (
                      <small className="muted">
                        {t(
                          'يُحدَّد تلقائياً من ضبط موعد التسليم أعلاه.',
                          'Set automatically from the handover schedule above.',
                        )}
                      </small>
                    ) : null}
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
                    'إلزام المستأجر بتأكيد صحة البيانات مع قبول بنود العقد قبل التوقيع',
                    'Require tenant to confirm accurate data with contract acceptance before signing',
                  )}
                </strong>
              </span>
            </label>
          </fieldset>

          <fieldset className="approval-policy__step">
            <legend>{t('التسليم ومراجعة المستندات', 'Handover and document review')}</legend>
            <label
              className={`approval-policy__option${
                draft.allowHandoverBeforeDocVerify ? ' approval-policy__option--on' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={draft.allowHandoverBeforeDocVerify}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    allowHandoverBeforeDocVerify: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>
                  {t(
                    'السماح بتسليم المفاتيح قبل اكتمال اعتماد المستندات يدوياً',
                    'Allow key handover before manual document verification is finished',
                  )}
                </strong>
                <small className="muted">
                  {t(
                    'مراجعة المستندات تبقى مطلوبة دائماً. إن تُركت معطّلة (الافتراضي) لا يكتمل التسليم حتى تعتمد كل المستندات والشيكات.',
                    'Document review remains required either way. When off (default), handover cannot complete until every document and cheque is verified.',
                  )}
                </small>
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
  portal = 'owner',
  propertyId,
  kinds,
  rentPrerequisites = null,
  onOverrideChange,
}: {
  locale: 'ar' | 'en';
  portal?: 'owner' | 'developer';
  propertyId: string | null;
  kinds: ApprovalPolicyKindState[];
  rentPrerequisites?: RentAutoContractPrerequisites | null;
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
            portal={portal}
            propertyId={propertyId}
            state={row}
            rentPrerequisites={rentPrerequisites}
            onOverrideChange={onOverrideChange}
          />
        ) : null,
      )}
    </section>
  );
}
