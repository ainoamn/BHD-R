'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { browserMutation } from '@/lib/api';
import { leaseContractTemplateOptions } from '@/lib/contract-template-labels';
import { formatMoney, toMinorUnits } from '@/lib/format';
import {
  clearRenewalDraft,
  readRenewalDraft,
  writeRenewalDraft,
  type LeaseRenewalDraft,
  type RenewalAdjustmentDraft,
  type RenewalChequeDraft,
} from '@/lib/lease-renewal-draft';
import type { LeaseRenewalContext } from '@/lib/lease-renewal-neon';
import {
  ADJUSTMENT_RECURRENCES,
  ADJUSTMENT_SCOPES,
  FREQUENCY_MONTHS,
  PAYMENT_FREQUENCIES,
  PAYMENT_METHODS,
  addDays,
  buildRentSchedule,
  contractPeriod,
  endDateForMonths,
  isIsoDate,
  type PaymentFrequency,
  type PaymentMethod,
} from '@/lib/lease-terms';
import {
  FREQUENCY_LABELS,
  PAYMENT_METHOD_LABELS,
  RECURRENCE_LABELS,
  SCOPE_LABELS,
  pick,
} from '@/components/lease-terms-view';
import type { CurrencyCode } from '@bhd-r/contracts';

const EXTRA_SUGGESTIONS: Array<[string, string]> = [
  ['إنترنت', 'Internet'],
  ['مواقف سيارات', 'Parking'],
  ['رسوم خدمات', 'Service charges'],
  ['كهرباء', 'Electricity'],
  ['ماء', 'Water'],
  ['صيانة', 'Maintenance'],
  ['خصم ترحيبي', 'Welcome discount'],
];

function moneyDigits(currency: string): number {
  return currency === 'OMR' || currency === 'BHD' || currency === 'KWD' ? 3 : 2;
}

function fromMinor(minor: string, currency: string): string {
  const digits = moneyDigits(currency);
  const n = Number(minor);
  if (!Number.isFinite(n)) return '';
  return (n / 10 ** digits).toFixed(digits).replace(/\.?0+$/, '');
}

function emptyAdjustment(): RenewalAdjustmentDraft {
  return {
    kind: 'add',
    title: '',
    amount: '',
    recurrence: 'monthly',
    scope: 'contract_end',
    months: '',
  };
}

function defaultDraft(ctx: LeaseRenewalContext): LeaseRenewalDraft {
  const rent = fromMinor(ctx.lease.rentMinor, ctx.lease.currency);
  const months = '12';
  const endsOn = endDateForMonths(ctx.renewalStartsOn, 12);
  const leaseTemplates = leaseContractTemplateOptions(ctx.templates, 'ar');
  return {
    version: 1,
    templateVersionId: leaseTemplates[0]?.id ?? ctx.templates[0]?.id ?? '',
    months,
    endsOn,
    rent,
    graceDays: '0',
    graceAsDiscount: true,
    paymentMethod: 'cheque',
    paymentFrequency: 'monthly',
    paymentDay: String(ctx.lease.billingDay || 5),
    chequeBankName: '',
    adjustments: [],
    cheques: [],
    additionalTerms: '',
    updatedAt: new Date().toISOString(),
  };
}

export function LeaseRenewalForm({
  context,
  locale,
  portal = 'owner',
}: {
  context: LeaseRenewalContext;
  locale: 'ar' | 'en';
  portal?: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const currency = context.lease.currency as CurrencyCode;
  const [draft, setDraft] = useState<LeaseRenewalDraft>(() => {
    const saved = typeof window !== 'undefined' ? readRenewalDraft(context.lease.id) : null;
    return saved ?? defaultDraft(context);
  });
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const saved = readRenewalDraft(context.lease.id);
    if (saved) {
      setDraft(saved);
      setRestoredDraft(true);
      setScheduleTouched(Boolean(saved.cheques.length));
    }
  }, [context.lease.id]);

  useEffect(() => {
    const save = () => writeRenewalDraft(context.lease.id, draftRef.current);
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      save();
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [context.lease.id]);

  const templates = useMemo(
    () => leaseContractTemplateOptions(context.templates, locale),
    [context.templates, locale],
  );

  const rentMinor = useMemo(() => {
    try {
      return Number(toMinorUnits(draft.rent || '0', currency));
    } catch {
      return Number(context.lease.rentMinor);
    }
  }, [draft.rent, currency, context.lease.rentMinor]);

  const graceDays = Math.max(0, Math.min(90, Number(draft.graceDays) || 0));
  const graceAmountMinor = Math.round((rentMinor / 30) * graceDays);

  const period = useMemo(() => {
    if (!isIsoDate(context.renewalStartsOn) || !isIsoDate(draft.endsOn)) {
      return { months: Number(draft.months) || 0, extraDays: 0 };
    }
    return contractPeriod(context.renewalStartsOn, draft.endsOn);
  }, [context.renewalStartsOn, draft.endsOn, draft.months]);

  function patch(partial: Partial<LeaseRenewalDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function setMonths(value: string) {
    const months = Math.max(1, Math.min(120, Number(value) || 0));
    const endsOn =
      months > 0 && isIsoDate(context.renewalStartsOn)
        ? endDateForMonths(context.renewalStartsOn, months)
        : draft.endsOn;
    patch({ months: String(months || ''), endsOn });
    setScheduleTouched(false);
  }

  function setEndsOn(value: string) {
    if (!isIsoDate(value)) {
      patch({ endsOn: value });
      return;
    }
    const next = contractPeriod(context.renewalStartsOn, value);
    patch({ endsOn: value, months: String(Math.max(1, next.months) || '') });
    setScheduleTouched(false);
  }

  function rebuildCheques(
    next: Pick<
      LeaseRenewalDraft,
      'endsOn' | 'rent' | 'paymentFrequency' | 'paymentDay' | 'paymentMethod' | 'chequeBankName'
    >,
  ): RenewalChequeDraft[] {
    if (next.paymentMethod !== 'cheque') return [];
    const minor = (() => {
      try {
        return Number(toMinorUnits(next.rent || '0', currency));
      } catch {
        return Number(context.lease.rentMinor);
      }
    })();
    if (!isIsoDate(context.renewalStartsOn) || !isIsoDate(next.endsOn) || minor <= 0) return [];
    const rows = buildRentSchedule({
      startsOn: context.renewalStartsOn,
      endsOn: next.endsOn,
      monthlyRentMinor: minor,
      paymentDay: Math.min(28, Math.max(1, Number(next.paymentDay) || 5)),
      frequency: next.paymentFrequency,
    });
    return rows.map((row, index) => ({
      bankName: next.chequeBankName,
      chequeNumber: String(index + 1),
      amount: fromMinor(String(row.rentMinor), currency),
      dueOn: row.dueOn,
    }));
  }

  useEffect(() => {
    if (scheduleTouched) return;
    if (draft.paymentMethod !== 'cheque') {
      if (draft.cheques.length) patch({ cheques: [] });
      return;
    }
    const next = rebuildCheques(draft);
    const same =
      next.length === draft.cheques.length &&
      next.every(
        (row, i) =>
          row.dueOn === draft.cheques[i]?.dueOn && row.amount === draft.cheques[i]?.amount,
      );
    if (!same) patch({ cheques: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when schedule drivers change
  }, [
    draft.paymentMethod,
    draft.paymentFrequency,
    draft.paymentDay,
    draft.endsOn,
    draft.rent,
    draft.chequeBankName,
    scheduleTouched,
  ]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!draft.templateVersionId) throw new Error(ar ? 'اختر قالب الملحق' : 'Choose a template');
      if (!isIsoDate(draft.endsOn) || draft.endsOn <= context.lease.endsOn) {
        throw new Error(
          ar ? 'تاريخ النهاية الجديد يجب أن يكون بعد نهاية العقد الحالي' : 'New end date must follow the current term',
        );
      }
      const rentMinorStr = toMinorUnits(draft.rent || fromMinor(context.lease.rentMinor, currency), currency);
      const adjustments = draft.adjustments
        .filter((row) => row.title.trim() && row.amount.trim())
        .map((row) => ({
          kind: row.kind,
          title: row.title.trim(),
          amount: {
            amountMinor: toMinorUnits(row.amount, currency),
            currency,
          },
        }));
      const cheques =
        draft.paymentMethod === 'cheque'
          ? draft.cheques
              .filter((row) => row.bankName && row.chequeNumber && row.amount && row.dueOn)
              .map((row) => ({
                bankName: row.bankName.trim(),
                chequeNumber: row.chequeNumber.trim(),
                amount: { amountMinor: toMinorUnits(row.amount, currency), currency },
                dueOn: row.dueOn,
              }))
          : [];
      await browserMutation(`/v1/leasing/leases/${encodeURIComponent(context.lease.id)}/renewals`, {
        method: 'POST',
        body: JSON.stringify({
          templateVersionId: draft.templateVersionId,
          endsOn: draft.endsOn,
          rent: { amountMinor: rentMinorStr, currency },
          graceDays,
          graceAsDiscount: draft.graceAsDiscount,
          graceAmount: {
            amountMinor: String(graceAmountMinor),
            currency,
          },
          adjustments,
          cheques,
          ...(draft.additionalTerms.trim()
            ? { additionalTerms: draft.additionalTerms.trim() }
            : {}),
          paymentMethod: draft.paymentMethod,
          paymentFrequency: draft.paymentFrequency,
          months: period.months,
        }),
      });
      clearRenewalDraft(context.lease.id);
      router.push(`/${portal}/leasing`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  function onCancel() {
    writeRenewalDraft(context.lease.id, draft);
    router.push(`/${portal}/leasing`);
  }

  const place =
    locale === 'ar'
      ? `${context.property.nameAr} · ${context.unit.code}`
      : `${context.property.nameEn || context.property.nameAr} · ${context.unit.code}`;

  return (
    <div className="form-shell lease-renewal">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT CONTROL</span>
          <h1>{ar ? 'إنشاء ملحق تجديد' : 'Create renewal addendum'}</h1>
          <p className="muted">
            {ar
              ? 'لن يتغير العقد الحالي حتى يُعتمد الملحق ويوقعه المالك والمستأجر.'
              : 'The current lease will not change until the addendum is approved and signed.'}
          </p>
        </div>
        <Link className="button button--quiet" href={`/${portal}/leasing`} onClick={() => writeRenewalDraft(context.lease.id, draft)}>
          {ar ? 'العودة للتأجير' : 'Back to leasing'}
        </Link>
      </header>

      {restoredDraft ? (
        <div className="notice" role="status">
          {ar
            ? 'تم استرجاع مسودة التجديد المحفوظة مسبقاً. يمكنك المتابعة أو مسحها.'
            : 'A previous renewal draft was restored. Continue or clear it.'}
          <button
            type="button"
            className="button button--quiet"
            style={{ marginInlineStart: '0.75rem' }}
            onClick={() => {
              clearRenewalDraft(context.lease.id);
              setDraft(defaultDraft(context));
              setRestoredDraft(false);
              setScheduleTouched(false);
            }}
          >
            {ar ? 'مسح المسودة' : 'Clear draft'}
          </button>
        </div>
      ) : null}

      <section className="card lease-renewal__summary" aria-labelledby="renewal-prev-title">
        <h2 id="renewal-prev-title">{ar ? 'ملخص العقد السابق' : 'Previous contract summary'}</h2>
        <dl className="lease-renewal__facts">
          <div>
            <dt>{ar ? 'رقم العقد' : 'Contract no.'}</dt>
            <dd dir="ltr">{context.contract?.reference || '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
            <dd>{context.tenantName}</dd>
          </div>
          <div>
            <dt>{ar ? 'العقار / الوحدة' : 'Property / unit'}</dt>
            <dd>{place}</dd>
          </div>
          <div>
            <dt>{ar ? 'البداية' : 'Starts'}</dt>
            <dd dir="ltr">{context.lease.startsOn}</dd>
          </div>
          <div>
            <dt>{ar ? 'النهاية' : 'Ends'}</dt>
            <dd dir="ltr">{context.lease.endsOn}</dd>
          </div>
          <div>
            <dt>{ar ? 'الإيجار' : 'Rent'}</dt>
            <dd dir="ltr">{formatMoney(context.lease.rentMinor, currency, locale)}</dd>
          </div>
          <div>
            <dt>{ar ? 'فترة السماح' : 'Grace period'}</dt>
            <dd>
              {context.contract && context.contract.graceDays > 0
                ? `${context.contract.graceDays} ${ar ? 'يوم' : 'days'}${
                    context.contract.graceAmountMinor
                      ? ` · ${formatMoney(context.contract.graceAmountMinor, currency, locale)}`
                      : ''
                  }`
                : ar
                  ? 'لا توجد'
                  : 'None'}
            </dd>
          </div>
        </dl>
      </section>

      <form className="lease-renewal__form" onSubmit={(event) => void onSubmit(event)}>
        <section className="card">
          <h2>{ar ? 'مدة التجديد والإيجار' : 'Renewal term & rent'}</h2>
          <div className="form-grid">
            <label className="field">
              <span>{ar ? 'قالب ملحق العقد' : 'Addendum template'}</span>
              <select
                className="select"
                required
                value={draft.templateVersionId}
                onChange={(event) => patch({ templateVersionId: event.target.value })}
              >
                <option value="">{ar ? 'اختر…' : 'Select…'}</option>
                {templates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {locale === 'ar' ? row.nameAr : row.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{ar ? 'بداية الفترة الجديدة' : 'New period starts'}</span>
              <output className="input lcf-output" dir="ltr">
                {context.renewalStartsOn}
              </output>
            </label>
            <label className="field">
              <span>{ar ? 'مدة الأشهر' : 'Duration (months)'}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={120}
                required
                value={draft.months}
                onChange={(event) => setMonths(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{ar ? 'تاريخ النهاية الجديد' : 'New end date'}</span>
              <input
                className="input"
                type="date"
                required
                min={addDays(context.lease.endsOn, 1)}
                value={draft.endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
            <label className="field">
              <span>{`${ar ? 'الإيجار الجديد' : 'New rent'} · ${currency}`}</span>
              <input
                className="input"
                dir="ltr"
                inputMode="decimal"
                required
                value={draft.rent}
                onChange={(event) => {
                  patch({ rent: event.target.value });
                  setScheduleTouched(false);
                }}
              />
            </label>
            <label className="field">
              <span>{ar ? 'فترة السماح (أيام)' : 'Grace period (days)'}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={90}
                value={draft.graceDays}
                onChange={(event) => patch({ graceDays: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{ar ? 'مبلغ السماح (محسوب تلقائياً)' : 'Grace amount (auto)'}</span>
              <output className="input lcf-output" dir="ltr">
                {graceDays
                  ? formatMoney(String(graceAmountMinor), currency, locale)
                  : ar
                    ? '٠'
                    : '0'}
              </output>
            </label>
            <label className="checkbox-row span-2">
              <input
                type="checkbox"
                checked={draft.graceAsDiscount}
                onChange={(event) => patch({ graceAsDiscount: event.target.checked })}
              />
              <span>
                {ar
                  ? 'اعتبر أيام السماح خصماً من إجمالي ما يدفعه المستأجر'
                  : 'Treat grace days as a discount on what the tenant pays'}
              </span>
            </label>
          </div>
        </section>

        <section className="card">
          <h2>{ar ? '➕ مبالغ إضافية / خصومات' : '➕ Extra charges & discounts'}</h2>
          <p className="muted">
            {ar
              ? 'بنفس أسلوب عقد الإيجار: إضافة أو خصم، مع التكرار والمدة.'
              : 'Same style as the lease contract: charge or discount, with recurrence and scope.'}
          </p>
          <datalist id="renewal-extra-suggestions">
            {EXTRA_SUGGESTIONS.map(([arText, enText]) => (
              <option key={enText} value={ar ? arText : enText} />
            ))}
          </datalist>
          {draft.adjustments.map((item, index) => (
            <div key={index} className="lcf-line">
              <select
                className="select"
                value={item.kind}
                onChange={(event) => {
                  const kind = event.target.value as RenewalAdjustmentDraft['kind'];
                  const next = draft.adjustments.slice();
                  next[index] = { ...item, kind };
                  patch({ adjustments: next });
                }}
              >
                <option value="add">{ar ? 'إضافة' : 'Charge'}</option>
                <option value="discount">{ar ? 'خصم' : 'Discount'}</option>
              </select>
              <input
                className="input"
                maxLength={120}
                list="renewal-extra-suggestions"
                placeholder={ar ? 'البند (مثال: إنترنت، مواقف)' : 'Item (e.g. internet, parking)'}
                value={item.title}
                onChange={(event) => {
                  const next = draft.adjustments.slice();
                  next[index] = { ...item, title: event.target.value };
                  patch({ adjustments: next });
                }}
              />
              <input
                className="input"
                dir="ltr"
                inputMode="decimal"
                placeholder={ar ? 'المبلغ' : 'Amount'}
                value={item.amount}
                onChange={(event) => {
                  const next = draft.adjustments.slice();
                  next[index] = { ...item, amount: event.target.value };
                  patch({ adjustments: next });
                }}
              />
              <select
                className="select"
                value={item.recurrence}
                onChange={(event) => {
                  const next = draft.adjustments.slice();
                  next[index] = {
                    ...item,
                    recurrence: event.target.value as RenewalAdjustmentDraft['recurrence'],
                  };
                  patch({ adjustments: next });
                }}
              >
                {ADJUSTMENT_RECURRENCES.map((value) => (
                  <option key={value} value={value}>
                    {pick(RECURRENCE_LABELS[value], ar)}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={item.scope}
                onChange={(event) => {
                  const next = draft.adjustments.slice();
                  next[index] = {
                    ...item,
                    scope: event.target.value as RenewalAdjustmentDraft['scope'],
                  };
                  patch({ adjustments: next });
                }}
              >
                {ADJUSTMENT_SCOPES.map((value) => (
                  <option key={value} value={value}>
                    {pick(SCOPE_LABELS[value], ar)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--quiet"
                onClick={() =>
                  patch({ adjustments: draft.adjustments.filter((_, i) => i !== index) })
                }
              >
                {ar ? 'حذف' : 'Remove'}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button--quiet"
            onClick={() => patch({ adjustments: [...draft.adjustments, emptyAdjustment()] })}
          >
            {ar ? '＋ إضافة بند' : '＋ Add item'}
          </button>
        </section>

        <section className="card">
          <h2>{ar ? 'طريقة الدفع وجدول الاستحقاق' : 'Payment method & due schedule'}</h2>
          <div className="form-grid">
            <label className="field">
              <span>{ar ? 'طريقة الدفع' : 'Payment method'}</span>
              <select
                className="select"
                value={draft.paymentMethod}
                onChange={(event) => {
                  patch({ paymentMethod: event.target.value as PaymentMethod });
                  setScheduleTouched(false);
                }}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {pick(PAYMENT_METHOD_LABELS[method], ar)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{ar ? 'دورية الدفع' : 'Payment frequency'}</span>
              <select
                className="select"
                value={draft.paymentFrequency}
                onChange={(event) => {
                  patch({ paymentFrequency: event.target.value as PaymentFrequency });
                  setScheduleTouched(false);
                }}
              >
                {PAYMENT_FREQUENCIES.map((freq) => (
                  <option key={freq} value={freq}>
                    {pick(FREQUENCY_LABELS[freq], ar)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{ar ? 'يوم الاستحقاق (1–28)' : 'Due day (1–28)'}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={28}
                value={draft.paymentDay}
                onChange={(event) => {
                  patch({ paymentDay: event.target.value });
                  setScheduleTouched(false);
                }}
              />
            </label>
            {draft.paymentMethod === 'cheque' ? (
              <label className="field">
                <span>{ar ? 'بنك الشيكات (افتراضي)' : 'Default cheque bank'}</span>
                <input
                  className="input"
                  value={draft.chequeBankName}
                  onChange={(event) => {
                    patch({ chequeBankName: event.target.value });
                    setScheduleTouched(false);
                  }}
                />
              </label>
            ) : null}
          </div>

          <p className="muted">
            {ar
              ? `حسب المدة (${period.months} شهر) والدورية (${FREQUENCY_MONTHS[draft.paymentFrequency]} شهر): يُنشأ ${draft.cheques.length || '—'} قسط/شيك.`
              : `From ${period.months} months and ${FREQUENCY_MONTHS[draft.paymentFrequency]}-month frequency: ${draft.cheques.length || '—'} instalment(s).`}
          </p>

          {draft.paymentMethod === 'cheque' && draft.cheques.length ? (
            <div className="lease-renewal__cheques">
              {draft.cheques.map((cheque, index) => (
                <div key={index} className="form-grid lease-renewal__cheque-row">
                  <label className="field">
                    <span>{ar ? `شيك ${index + 1} — البنك` : `Cheque ${index + 1} — bank`}</span>
                    <input
                      className="input"
                      required
                      value={cheque.bankName}
                      onChange={(event) => {
                        setScheduleTouched(true);
                        const next = draft.cheques.slice();
                        next[index] = { ...cheque, bankName: event.target.value };
                        patch({ cheques: next });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>{ar ? 'رقم الشيك' : 'Cheque number'}</span>
                    <input
                      className="input"
                      required
                      value={cheque.chequeNumber}
                      onChange={(event) => {
                        setScheduleTouched(true);
                        const next = draft.cheques.slice();
                        next[index] = { ...cheque, chequeNumber: event.target.value };
                        patch({ cheques: next });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>{`${ar ? 'المبلغ' : 'Amount'} · ${currency}`}</span>
                    <input
                      className="input"
                      dir="ltr"
                      required
                      value={cheque.amount}
                      onChange={(event) => {
                        setScheduleTouched(true);
                        const next = draft.cheques.slice();
                        next[index] = { ...cheque, amount: event.target.value };
                        patch({ cheques: next });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>{ar ? 'تاريخ الاستحقاق' : 'Due date'}</span>
                    <input
                      className="input"
                      type="date"
                      required
                      value={cheque.dueOn}
                      onChange={(event) => {
                        setScheduleTouched(true);
                        const next = draft.cheques.slice();
                        next[index] = { ...cheque, dueOn: event.target.value };
                        patch({ cheques: next });
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : draft.paymentMethod !== 'cheque' ? (
            <p className="muted">
              {ar
                ? 'للنقد أو التحويل لا تُطلب أرقام شيكات؛ تُحفظ تواريخ الاستحقاق حسب الدورية عند الاعتماد.'
                : 'Cash/transfer does not need cheque numbers; due dates follow the chosen frequency.'}
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>{ar ? 'شروط إضافية' : 'Additional terms'}</h2>
          <label className="field">
            <textarea
              className="textarea"
              rows={5}
              maxLength={10_000}
              value={draft.additionalTerms}
              onChange={(event) => patch({ additionalTerms: event.target.value })}
            />
          </label>
        </section>

        {error ? (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="form-actions">
          <button className="button button--quiet" type="button" onClick={onCancel} disabled={busy}>
            {ar ? 'إلغاء وحفظ كمسودة' : 'Cancel & save draft'}
          </button>
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy
              ? ar
                ? 'جارٍ الحفظ…'
                : 'Saving…'
              : ar
                ? 'حفظ وإرسال للاعتماد'
                : 'Save & request approval'}
          </button>
        </div>
      </form>
    </div>
  );
}
