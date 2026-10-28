'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  LeaseContractForm,
  type LeaseBankAccountOption,
  type LeaseContractPayload,
} from '@/components/lease-contract-form';
import { browserMutation } from '@/lib/api';
import type { AccountingSettings } from '@/lib/accounting-integrity';
import { leaseContractTemplateOptions } from '@/lib/contract-template-labels';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { clearRenewalDraft } from '@/lib/lease-renewal-draft';
import type { LeaseRenewalContext } from '@/lib/lease-renewal-neon';
import {
  computeLeaseTerms,
  contractPeriod,
  minorDigitsFor,
  parseMoney,
  type LeaseTermsDraft,
} from '@/lib/lease-terms';
import type { CurrencyCode } from '@bhd-r/contracts';

type StoredRenewalDraft = {
  version: 2;
  templateVersionId: string;
  terms: LeaseTermsDraft;
  updatedAt: string;
};

const DRAFT_V2 = 'bhd-r.lease-renewal-draft.v2.';

function readV2(leaseId: string): StoredRenewalDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${DRAFT_V2}${leaseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRenewalDraft;
    if (!parsed || parsed.version !== 2 || !parsed.terms) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeV2(leaseId: string, draft: StoredRenewalDraft) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${DRAFT_V2}${leaseId}`,
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

function clearV2(leaseId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${DRAFT_V2}${leaseId}`);
  } catch {
    /* ignore */
  }
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
  const templates = useMemo(
    () => leaseContractTemplateOptions(context.templates, locale),
    [context.templates, locale],
  );
  const [templateVersionId, setTemplateVersionId] = useState(
    () => context.defaultTemplateVersionId || templates[0]?.id || '',
  );
  const [terms, setTerms] = useState<LeaseTermsDraft>(context.initialTerms);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<LeaseBankAccountOption[]>([]);
  const [requirements, setRequirements] = useState<
    Array<{ code: string; labelAr: string; labelEn: string }>
  >([]);

  useEffect(() => {
    const saved = readV2(context.lease.id);
    if (saved) {
      setTerms(saved.terms);
      if (saved.templateVersionId) setTemplateVersionId(saved.templateVersionId);
      setRestoredDraft(true);
      return;
    }
    // Drop legacy v1 drafts so we do not mix shapes.
    clearRenewalDraft(context.lease.id);
  }, [context.lease.id]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/owner/accounting/settings', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { settings?: AccountingSettings };
        if (cancelled || !data.settings?.bankAccounts) return;
        setBankAccounts(
          data.settings.bankAccounts.map((row) => ({
            id: row.id,
            labelAr: row.labelAr,
            labelEn: row.labelEn,
            bankName: row.bankName,
            accountHolderName: row.accountHolderName,
            accountHolderNameEn: row.accountHolderNameEn,
            defaultForRent: row.defaultForRent,
            active: row.active,
            propertyIds: row.propertyIds,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const place =
    locale === 'ar'
      ? `${context.property.nameAr} · ${context.unit.code}`
      : `${context.property.nameEn || context.property.nameAr} · ${context.unit.code}`;

  async function onSubmit(payload: LeaseContractPayload) {
    setBusy(true);
    setError(null);
    try {
      if (!templateVersionId) {
        throw new Error(ar ? 'اختر قالب ملحق التجديد' : 'Choose a renewal template');
      }
      if (payload.terms.startsOn !== context.renewalStartsOn) {
        throw new Error(
          ar
            ? 'تاريخ بداية التجديد يجب أن يكون اليوم التالي لنهاية العقد الحالي'
            : 'Renewal must start the day after the current lease ends',
        );
      }
      if (!payload.terms.endsOn || payload.terms.endsOn <= context.lease.endsOn) {
        throw new Error(
          ar
            ? 'تاريخ النهاية الجديد يجب أن يكون بعد نهاية العقد الحالي'
            : 'New end date must follow the current term',
        );
      }

      const digits = minorDigitsFor(currency);
      const computed = computeLeaseTerms(payload.terms, currency, digits, {
        deferUntilHandover: ['meters'],
      });
      if (!computed.ok) {
        throw new Error(
          ar ? 'تحقّق من حقول العقد قبل الحفظ' : 'Check contract fields before saving',
        );
      }
      const rentMinor =
        parseMoney(payload.terms.monthlyRent, digits) ??
        Number(toMinorUnits(payload.terms.monthlyRent || '0', currency));
      const period = contractPeriod(payload.terms.startsOn, payload.terms.endsOn);
      const adjustments = computed.terms.adjustments.map((row) => ({
        kind: row.kind,
        title: row.title,
        amount: {
          amountMinor: String(row.amountMinor),
          currency,
        },
      }));
      const cheques =
        computed.terms.paymentMethod === 'cheque'
          ? computed.terms.schedule.map((row, index) => ({
              bankName:
                row.bankName ||
                computed.terms.chequeBankName ||
                payload.terms.chequeBankName ||
                '—',
              chequeNumber: row.chequeNumber || String(index + 1),
              amount: {
                amountMinor: String(row.totalMinor),
                currency,
              },
              dueOn: row.dueOn,
            }))
          : [];

      await browserMutation(
        `/v1/leasing/leases/${encodeURIComponent(context.lease.id)}/renewals`,
        {
          method: 'POST',
          body: JSON.stringify({
            templateVersionId,
            endsOn: payload.terms.endsOn,
            rent: { amountMinor: String(rentMinor), currency },
            graceDays: computed.terms.graceDays,
            graceAsDiscount: computed.terms.graceAsDiscount,
            graceAmount: {
              amountMinor: String(computed.terms.graceAmountMinor),
              currency,
            },
            adjustments,
            cheques,
            paymentMethod: computed.terms.paymentMethod,
            paymentFrequency: computed.terms.paymentFrequency,
            months: period.months,
            leaseTerms: computed.terms,
            chequeAccountName: computed.terms.chequeAccountName,
            chequeBankName: computed.terms.chequeBankName,
            rentBankAccountId: computed.terms.rentBankAccountId,
            ...(payload.terms.notes?.trim()
              ? { additionalTerms: payload.terms.notes.trim() }
              : {}),
          }),
        },
      );
      clearV2(context.lease.id);
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
    writeV2(context.lease.id, {
      version: 2,
      templateVersionId,
      terms,
      updatedAt: new Date().toISOString(),
    });
    router.push(`/${portal}/leasing`);
  }

  return (
    <div className="form-shell lease-renewal">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT CONTROL</span>
          <h1>{ar ? 'إنشاء ملحق تجديد' : 'Create renewal addendum'}</h1>
          <p className="muted">
            {ar
              ? 'نفس خطوات وألوان عقد الإيجار الجديد — مع تعبئة تلقائية من العقد السابق (الضريبة، الإضافات، اسم الشيكات).'
              : 'Same steps and colours as a new lease — prefilled from the previous contract (VAT, extras, cheque payee).'}
          </p>
        </div>
        <Link
          className="button button--quiet"
          href={`/${portal}/leasing`}
          onClick={() =>
            writeV2(context.lease.id, {
              version: 2,
              templateVersionId,
              terms,
              updatedAt: new Date().toISOString(),
            })
          }
        >
          {ar ? 'العودة للتأجير' : 'Back to leasing'}
        </Link>
      </header>

      {restoredDraft ? (
        <div className="notice" role="status">
          {ar
            ? 'تم استرجاع مسودة التجديد المحفوظة مسبقاً.'
            : 'A previous renewal draft was restored.'}
          <button
            type="button"
            className="button button--quiet"
            style={{ marginInlineStart: '0.75rem' }}
            onClick={() => {
              clearV2(context.lease.id);
              clearRenewalDraft(context.lease.id);
              setTerms(context.initialTerms);
              setTemplateVersionId(context.defaultTemplateVersionId || templates[0]?.id || '');
              setRestoredDraft(false);
            }}
          >
            {ar ? 'إعادة من العقد السابق' : 'Reset from previous contract'}
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
            <dt>{ar ? 'الضريبة المضافة' : 'VAT'}</dt>
            <dd>
              {context.initialTerms.vatEnabled
                ? `${context.initialTerms.vatRate}%`
                : ar
                  ? 'غير مشمولة'
                  : 'Not applicable'}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'مبالغ إضافية' : 'Extras'}</dt>
            <dd>
              {context.initialTerms.adjustments.length
                ? context.initialTerms.adjustments.length
                : ar
                  ? 'لا توجد'
                  : 'None'}
            </dd>
          </div>
        </dl>
      </section>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <LeaseContractForm
        key={`${context.lease.id}:${restoredDraft ? 'restored' : 'seed'}`}
        units={[context.unit]}
        tenants={[context.tenant]}
        canSign
        locale={locale}
        busy={busy}
        bankAccounts={bankAccounts}
        propertyId={context.property.id}
        lockTenantName
        lockStartsOn
        renewalMode
        previousMeters={context.previousMeters}
        tenantFromDirectory
        municipalAfterHandover
        initialTenant={context.initialTenant}
        initialTerms={terms}
        requirements={requirements}
        onRequirementsChange={setRequirements}
        heading={ar ? 'بيانات عقد التجديد' : 'Renewal contract details'}
        submitLabel={ar ? 'إنشاء ملحق التجديد' : 'Create renewal addendum'}
        footnote={
          ar
            ? 'لن يتغير العقد الحالي حتى يُعتمد الملحق ويوقّعه المالك والمستأجر. الشيكات تُكتب بالاسم الظاهر من الحساب البنكي.'
            : 'The current lease will not change until the addendum is approved and signed. Cheques use the bank-account payee name.'
        }
        lead={
          <div className="form-grid lease-renewal__template">
            <label className="field">
              <span>{ar ? 'قالب ملحق العقد' : 'Addendum template'}</span>
              <select
                className="select"
                required
                value={templateVersionId}
                onChange={(event) => setTemplateVersionId(event.target.value)}
              >
                <option value="">{ar ? 'اختر…' : 'Select…'}</option>
                {templates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {locale === 'ar' ? row.nameAr : row.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted span-2">
              {ar
                ? 'الإضافات والخصومات والضريبة واسم المستفيد على الشيكات منسوخة من العقد السابق ويمكنك تعديلها قبل الحفظ.'
                : 'Extras, discounts, VAT and the cheque payee are copied from the previous contract and remain editable.'}
            </p>
          </div>
        }
        onSubmit={(payload) => {
          setTerms(payload.terms);
          writeV2(context.lease.id, {
            version: 2,
            templateVersionId,
            terms: payload.terms,
            updatedAt: new Date().toISOString(),
          });
          void onSubmit(payload);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}
