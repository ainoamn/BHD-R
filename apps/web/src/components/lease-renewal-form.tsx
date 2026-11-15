'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  LeaseContractForm,
  type LeaseBankAccountOption,
  type LeaseContractPayload,
} from '@/components/lease-contract-form';
import { ApiError, browserNextMutation, humanizeBrowserError } from '@/lib/api';
import type { AccountingSettings } from '@/lib/accounting-integrity';
import { leaseContractTemplateOptions } from '@/lib/contract-template-labels';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { clearRenewalDraft } from '@/lib/lease-renewal-draft';
import type { LeaseRenewalContext } from '@/lib/lease-renewal-neon';
import {
  RENEWAL_HEADS_UP_DAYS,
  renewalEarlyExceptionWarning,
  renewalTooEarlyMessage,
} from '@/lib/lease-renewal-window';
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
  portal?: 'owner' | 'developer' | 'tenant';
}) {
  const ar = locale === 'ar';
  const isTenant = portal === 'tenant';
  const router = useRouter();
  const currency = context.lease.currency as CurrencyCode;
  const homeHref = isTenant ? '/tenant/contracts' : `/${portal}/leasing`;
  const renewalsApi = isTenant
    ? `/api/tenant/leasing/${encodeURIComponent(context.lease.id)}/renewals`
    : `/api/owner/leasing/${encodeURIComponent(context.lease.id)}/renewals`;
  const voidApi = (contractId: string) =>
    isTenant
      ? `/api/tenant/contracts/${encodeURIComponent(contractId)}/void-renewal-docs`
      : `/api/owner/contracts/${encodeURIComponent(contractId)}/void-renewal-docs`;
  const templates = useMemo(
    () => leaseContractTemplateOptions(context.templates, locale),
    [context.templates, locale],
  );
  const [templateVersionId, setTemplateVersionId] = useState(
    () => context.defaultTemplateVersionId || templates[0]?.id || '',
  );
  // Oman rent renewals default to cheque PDCs unless the previous term was cash.
  const [terms, setTerms] = useState<LeaseTermsDraft>(() => {
    const base = {
      ...context.initialTerms,
      paymentMethod:
        context.initialTerms.paymentMethod === 'cash' ? ('cash' as const) : ('cheque' as const),
    };
    if (base.paymentMethod !== 'cheque') return base;
    return {
      ...base,
      chequeAccountName:
        base.chequeAccountName?.trim() || context.rentChequePayee.accountName || '',
      chequeBankName: base.chequeBankName?.trim() || context.rentChequePayee.bankName || '',
      rentBankAccountId: base.rentBankAccountId?.trim() || context.initialTerms.rentBankAccountId || '',
    };
  });
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlyExceptionAck, setEarlyExceptionAck] = useState(false);
  /** Reopen renewal field form (seeded from incomplete addendum) instead of contract document. */
  const [editingPending, setEditingPending] = useState(false);
  const pendingRenewal = context.pendingRenewal;
  /** Owner may continue any incomplete addendum; tenant only their own draft. */
  const canContinuePending = Boolean(
    pendingRenewal &&
      (!isTenant ||
        (pendingRenewal.initiatedByTenant && pendingRenewal.status === 'draft')),
  );
  const showCreateForm = !pendingRenewal || (editingPending && canContinuePending);
  const [bankAccounts, setBankAccounts] = useState<LeaseBankAccountOption[]>([]);
  const [requirements, setRequirements] = useState<
    Array<{ code: string; labelAr: string; labelEn: string }>
  >([]);
  const windowOpen = context.renewalWindow.open;
  const canEarly = !isTenant && context.renewalWindow.canEarlyException;
  const daysLeft = context.renewalWindow.daysRemaining;
  const needsEarlyException = !windowOpen && canEarly;
  const formBlocked = !windowOpen && !canEarly;

  useEffect(() => {
    if (isTenant && !templateVersionId && context.defaultTemplateVersionId) {
      setTemplateVersionId(context.defaultTemplateVersionId);
    }
  }, [isTenant, templateVersionId, context.defaultTemplateVersionId]);

  useEffect(() => {
    const saved = readV2(context.lease.id);
    if (saved) {
      const restored = saved.terms;
      // Keep landlord cheque payee if an old local draft blanked it.
      const merged =
        restored.paymentMethod === 'cheque' &&
        (!restored.rentBankAccountId?.trim() ||
          !restored.chequeBankName?.trim() ||
          !restored.chequeAccountName?.trim())
          ? {
              ...restored,
              rentBankAccountId:
                restored.rentBankAccountId?.trim() ||
                context.initialTerms.rentBankAccountId ||
                '',
              chequeBankName:
                restored.chequeBankName?.trim() ||
                context.initialTerms.chequeBankName ||
                context.rentChequePayee.bankName ||
                '',
              chequeAccountName:
                restored.chequeAccountName?.trim() ||
                context.initialTerms.chequeAccountName ||
                context.rentChequePayee.accountName ||
                '',
            }
          : restored;
      setTerms(merged);
      if (saved.templateVersionId) setTemplateVersionId(saved.templateVersionId);
      setRestoredDraft(true);
      return;
    }
    // Drop legacy v1 drafts so we do not mix shapes.
    clearRenewalDraft(context.lease.id);
  }, [context.lease.id, context.initialTerms, context.rentChequePayee]);

  useEffect(() => {
    if (isTenant) return;
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
  }, [isTenant]);

  const place =
    locale === 'ar'
      ? `${context.property.nameAr} · ${context.unit.code}`
      : `${context.property.nameEn || context.property.nameAr} · ${context.unit.code}`;

  async function onSubmit(payload: LeaseContractPayload) {
    if (formBlocked) {
      setError(renewalTooEarlyMessage(ar, daysLeft));
      return;
    }
    if (needsEarlyException && !earlyExceptionAck) {
      setError(
        ar
          ? 'أكّد التجديد الاستثنائي أدناه للمتابعة — التجديد المبكر لمدير المؤسسة أو المالك فقط.'
          : 'Confirm the early-renewal exception below to continue — early renewal is for the organization manager or owner only.',
      );
      return;
    }
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
      // Tenant never picks the landlord bank; keep seeded payee from context / previous lease.
      const termsForCompute: LeaseTermsDraft =
        isTenant && payload.terms.paymentMethod === 'cheque'
          ? {
              ...payload.terms,
              rentBankAccountId:
                payload.terms.rentBankAccountId?.trim() ||
                context.initialTerms.rentBankAccountId ||
                '',
              chequeBankName:
                payload.terms.chequeBankName?.trim() || context.initialTerms.chequeBankName || '',
              chequeAccountName:
                payload.terms.chequeAccountName?.trim() ||
                context.initialTerms.chequeAccountName ||
                '',
            }
          : payload.terms;
      const computed = computeLeaseTerms(termsForCompute, currency, digits, {
        deferUntilHandover: ['meters'],
      });
      if (!computed.ok) {
        const computeError =
          computed.error === 'bank_account_required'
            ? ar
              ? isTenant
                ? 'بيانات مستفيد الشيكات غير مكتملة لدى المالك. تواصل مع المالك لإكمال الحساب البنكي ثم أعد المحاولة.'
                : 'اختر الحساب البنكي الذي تُكتب الشيكات باسمه قبل إنشاء الملحق.'
              : isTenant
                ? 'Cheque payee details are missing on the landlord side. Ask the landlord to complete the rent bank account, then try again.'
                : 'Choose the bank account cheques are payable to before creating the addendum.'
            : computed.error === 'invalid_schedule'
              ? ar
                ? 'جدول الدفع غير مكتمل — تحقق من التواريخ والمبالغ.'
                : 'Payment schedule is incomplete — check dates and amounts.'
              : ar
                ? 'تحقّق من حقول العقد قبل الحفظ.'
                : 'Check contract fields before saving.';
        throw new Error(computeError);
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
      const defaultBank =
        (computed.terms.chequeBankName || payload.terms.chequeBankName || '').trim() || 'Bank';
      const leaseShort = context.lease.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      const cheques =
        computed.terms.paymentMethod === 'cheque'
          ? computed.terms.schedule.map((row, index) => {
              const bank = (row.bankName || defaultBank).trim();
              const rawNumber = (row.chequeNumber || '').trim();
              // Prefer tenant-entered numbers; otherwise a lease-scoped provisional id
              // that will not collide with existing org cheque numbers (e.g. 2001).
              const chequeNumber =
                rawNumber || `RNW-${leaseShort}-${String(index + 1).padStart(2, '0')}`;
              return {
                bankName: bank.length >= 2 ? bank : defaultBank.length >= 2 ? defaultBank : 'Bank',
                chequeNumber,
                amount: {
                  amountMinor: String(row.totalMinor),
                  currency,
                },
                dueOn: row.dueOn,
              };
            })
          : [];

      // Compact terms only — avoid huge payloads (photos / noise) that break the BFF.
      const {
        meters,
        schedule,
        vatCheques,
        adjustments: termAdjustments,
        totals,
        ...termRest
      } = computed.terms;
      const leanLeaseTerms = {
        ...termRest,
        meters: {
          electricityReading: meters.electricityReading,
          waterReading: meters.waterReading,
        },
        schedule,
        vatCheques,
        adjustments: termAdjustments,
        totals,
      };

      const body: Record<string, unknown> = {
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
        leaseTerms: leanLeaseTerms,
      };
      if (period.months >= 1) {
        body.months = period.months;
      }
      if (computed.terms.chequeAccountName) {
        body.chequeAccountName = computed.terms.chequeAccountName;
      }
      if (computed.terms.chequeBankName) {
        body.chequeBankName = computed.terms.chequeBankName;
      }
      if (computed.terms.rentBankAccountId) {
        body.rentBankAccountId = computed.terms.rentBankAccountId;
      }
      if (payload.terms.notes?.trim()) {
        body.additionalTerms = payload.terms.notes.trim();
      }
      if (requirements.length) {
        body.requirements = requirements.map((row) => ({
          code: row.code,
          labelAr: row.labelAr,
          labelEn: row.labelEn,
        }));
      }
      if (needsEarlyException) {
        body.earlyException = true;
      }

      // Replace incomplete addendum first so create is not blocked by renewal_pending.
      if (pendingRenewal && canContinuePending) {
        await browserNextMutation(voidApi(pendingRenewal.id), {
          method: 'POST',
          body: JSON.stringify({
            note: ar
              ? 'استبدال ملحق غير مكتمل بعد تعديل الحقول'
              : 'Replaced incomplete addendum after field edits',
          }),
        });
      }

      // Save on Vercel → Neon (no Nest/Render). Same-origin Next CSRF.
      // Owner with sign permission delivers the addendum to the tenant immediately.
      // Tenant create stays as draft awaiting landlord review.
      await browserNextMutation(renewalsApi, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      clearV2(context.lease.id);
      clearRenewalDraft(context.lease.id);
      router.push(homeHref);
      router.refresh();
    } catch (caught) {
      let mapped: string;
      if (caught instanceof ApiError) {
        const code = caught.code;
        mapped =
          code === 'renewal_pending' || /unfinished renewal|already exists/i.test(caught.message)
            ? ar
              ? 'يوجد ملحق تجديد غير مكتمل لهذا العقد — أكمله أو ألغِه أولاً.'
              : 'An unfinished renewal already exists for this lease — finish or void it first.'
            : code === 'renewal_exception_required'
              ? ar
                ? 'التجديد المبكر استثناء لمدير المؤسسة أو المالك — أكّد الاستثناء للمتابعة.'
                : 'Early renewal requires owner/admin acknowledgement.'
              : code === 'renewal_too_early' ||
                  /within 3 months|renewal_too_early/i.test(caught.message)
                ? renewalTooEarlyMessage(ar, daysLeft)
                : code === 'lease_not_renewable' || /Only an active lease/i.test(caught.message)
                ? ar
                  ? 'يمكن تجديد العقود النشطة فقط.'
                  : 'Only an active lease can be renewed.'
                : code === 'renewal_date_invalid'
                ? ar
                  ? 'تاريخ النهاية الجديد يجب أن يكون بعد نهاية العقد الحالي.'
                  : 'New end date must follow the current term.'
                : code === 'forbidden'
                  ? ar
                    ? 'ليست لديك صلاحية إنشاء ملحق التجديد.'
                    : 'You do not have permission to create a renewal.'
                  : code === 'renewal_duplicate' ||
                      /unique|duplicate/i.test(`${code} ${caught.message}`)
                    ? ar
                      ? 'تعذّر الحفظ بسبب تكرار — حدّث الصفحة وأعد المحاولة.'
                      : 'Save failed due to a duplicate — refresh and retry.'
                    : code === 'csrf_rejected'
                      ? ar
                        ? 'رمز الحماية مرفوض — حدّث الصفحة وأعد المحاولة.'
                        : 'Security token rejected — refresh and retry.'
                      : caught.message && caught.message !== 'Request failed'
                        ? caught.message
                        : ar
                          ? 'تعذّر حفظ الملحق — تحقق من الحقول وأعد المحاولة.'
                          : 'Could not save the addendum — check the fields and try again.';
      } else {
        mapped = humanizeBrowserError(caught, ar);
      }
      setError(mapped);
      requestAnimationFrame(() => {
        document.getElementById('lcf-form-errors')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
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
    router.push(homeHref);
  }

  async function voidPendingRenewal() {
    if (!pendingRenewal || voidBusy) return;
    if (isTenant && !pendingRenewal.initiatedByTenant) return;
    const confirmed = window.confirm(
      ar
        ? `إلغاء الملحق غير المكتمل ${pendingRenewal.reference || ''}؟ يمكنك إنشاء تجديد جديد بعدها.`
        : `Void incomplete addendum ${pendingRenewal.reference || ''}? You can create a new renewal afterwards.`,
    );
    if (!confirmed) return;
    setVoidBusy(true);
    setError(null);
    try {
      await browserNextMutation(voidApi(pendingRenewal.id), {
        method: 'POST',
        body: JSON.stringify({
          note: ar ? 'إلغاء ملحق تجديد غير مكتمل من صفحة التجديد' : 'Abandoned incomplete renewal',
        }),
      });
      clearV2(context.lease.id);
      clearRenewalDraft(context.lease.id);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : humanizeBrowserError(caught, ar),
      );
    } finally {
      setVoidBusy(false);
    }
  }

  const pendingStatusLabel =
    pendingRenewal?.status === 'draft'
      ? ar
        ? 'مسودة'
        : 'Draft'
      : pendingRenewal?.status === 'sent'
        ? ar
          ? 'مُرسل للمستأجر'
          : 'Sent to tenant'
        : pendingRenewal?.status === 'partially_signed'
          ? ar
            ? 'توقيع جزئي'
            : 'Partially signed'
          : pendingRenewal?.status || '';

  return (
    <div className="form-shell lease-renewal">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · CONTRACT CONTROL</span>
          <h1>
            {pendingRenewal
              ? ar
                ? 'ملحق تجديد غير مكتمل'
                : 'Incomplete renewal addendum'
              : isTenant
                ? ar
                  ? 'طلب تجديد الإيجار'
                  : 'Request lease renewal'
                : ar
                  ? 'إنشاء ملحق تجديد'
                  : 'Create renewal addendum'}
          </h1>
          <p className="muted">
            {pendingRenewal
              ? ar
                ? 'يوجد ملحق محفوظ مسبقاً لهذا العقد — أكمله أو ألغِه قبل إنشاء ملحق جديد.'
                : 'An addendum is already saved for this lease — continue or void it before creating another.'
              : isTenant
                ? ar
                  ? 'عبّئ ملحق التجديد بنفس خطوات العقد الجديد. يُرسل للمالك للمراجعة ثم التوقيع.'
                  : 'Fill the renewal addendum like a new lease. It goes to the landlord for review, then signing.'
                : ar
                  ? 'نفس خطوات وألوان عقد الإيجار الجديد — مع تعبئة تلقائية من العقد السابق (الضريبة، الإضافات، اسم الشيكات).'
                  : 'Same steps and colours as a new lease — prefilled from the previous contract (VAT, extras, cheque payee).'}
          </p>
        </div>
        <Link
          className="button button--quiet"
          href={homeHref}
          onClick={() =>
            writeV2(context.lease.id, {
              version: 2,
              templateVersionId,
              terms,
              updatedAt: new Date().toISOString(),
            })
          }
        >
          {isTenant
            ? ar
              ? 'العودة لعقودي'
              : 'Back to contracts'
            : ar
              ? 'العودة للتأجير'
              : 'Back to leasing'}
        </Link>
      </header>

      {pendingRenewal && !editingPending ? (
        <div className="notice notice--warning" role="status">
          <p style={{ margin: 0 }}>
            {ar ? 'الملحق:' : 'Addendum:'}{' '}
            <strong dir="ltr">{pendingRenewal.reference || pendingRenewal.id.slice(0, 8)}</strong>
            {' · '}
            {pendingStatusLabel}
          </p>
          <p className="ops-hint" style={{ marginTop: '0.5rem' }}>
            {isTenant && !pendingRenewal.initiatedByTenant
              ? ar
                ? 'المالك يعمل على ملحق التجديد. عند إرساله إليك سيظهر في قائمة التجديد لإكماله.'
                : 'The landlord is preparing the renewal. When sent to you it will appear in your renewal list.'
              : ar
                ? 'أكمل تعديل حقول التجديد هنا، أو ألغِ الملحق غير المكتمل. مستند العقد للعرض فقط.'
                : 'Continue editing renewal fields here, or void the incomplete addendum. The contract page is view-only.'}
          </p>
          {error ? (
            <p className="notice notice--error" role="alert" style={{ marginTop: '0.75rem' }}>
              {error}
            </p>
          ) : null}
          <div
            className="ops-vacant-strip__actions"
            style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
          >
            {canContinuePending ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setTerms(pendingRenewal.initialTerms);
                  if (pendingRenewal.templateVersionId) {
                    setTemplateVersionId(pendingRenewal.templateVersionId);
                  }
                  setRestoredDraft(true);
                  setEditingPending(true);
                  setError(null);
                }}
              >
                {ar ? 'متابعة تعديل الحقول' : 'Continue editing fields'}
              </button>
            ) : null}
            <Link
              className="button button--quiet"
              href={
                isTenant
                  ? `/tenant/contracts/${encodeURIComponent(pendingRenewal.id)}`
                  : `/${portal}/contracts/${encodeURIComponent(pendingRenewal.id)}`
              }
            >
              {ar ? 'عرض مستند الملحق' : 'View addendum document'}
            </Link>
            {canContinuePending ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={voidBusy}
                onClick={() => void voidPendingRenewal()}
              >
                {voidBusy
                  ? ar
                    ? 'جارٍ الإلغاء…'
                    : 'Voiding…'
                  : ar
                    ? 'إلغاء الملحق غير المكتمل'
                    : 'Void incomplete addendum'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingRenewal && editingPending ? (
        <div className="notice" role="status">
          <p style={{ margin: 0 }}>
            {ar
              ? `تعدّل حقول الملحق ${pendingRenewal.reference || ''} — عند الحفظ يُستبدل الملحق غير المكتمل بالنسخة الجديدة.`
              : `Editing fields for ${pendingRenewal.reference || ''} — saving replaces the incomplete addendum.`}
          </p>
          <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setEditingPending(false);
                setTerms(context.initialTerms);
                setRestoredDraft(false);
              }}
            >
              {ar ? 'رجوع' : 'Back'}
            </button>
            <Link
              className="button button--quiet"
              href={
                isTenant
                  ? `/tenant/contracts/${encodeURIComponent(pendingRenewal.id)}`
                  : `/${portal}/contracts/${encodeURIComponent(pendingRenewal.id)}`
              }
            >
              {ar ? 'عرض المستند' : 'View document'}
            </Link>
          </div>
        </div>
      ) : null}

      {showCreateForm ? (
        <>
      {formBlocked ? (
        <div className="notice notice--warning" role="status">
          {renewalTooEarlyMessage(ar, daysLeft)}
        </div>
      ) : null}

      {needsEarlyException ? (
        <div className="notice notice--warning" role="status">
          <p style={{ margin: 0 }}>
            {daysLeft > RENEWAL_HEADS_UP_DAYS
              ? renewalEarlyExceptionWarning(ar, daysLeft)
              : ar
                ? `تنبيه: يتبقّى على هذا العقد ${daysLeft} يوماً. التجديد الآن استثناء لمدير المؤسسة أو المالك فقط.`
                : `Warning: ${daysLeft} days remain. Early renewal is an exception for the organization manager or owner only.`}
          </p>
          <label
            className="field"
            style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', marginTop: '0.75rem' }}
          >
            <input
              type="checkbox"
              checked={earlyExceptionAck}
              onChange={(event) => setEarlyExceptionAck(event.target.checked)}
            />
            <span>
              {ar
                ? `أؤكّد التجديد الاستثنائي رغم بقاء ${daysLeft} يوماً على العقد، وأتحمّل مسؤولية هذا القرار بصفتي مديراً أو مالكاً.`
                : `I confirm this exceptional renewal despite ${daysLeft} days remaining, as organization manager or owner.`}
            </span>
          </label>
        </div>
      ) : null}

      {!isTenant &&
      showCreateForm &&
      terms.paymentMethod === 'cheque' &&
      !context.rentChequePayee.complete ? (
        <div className="notice notice--warning" role="status">
          <p style={{ margin: 0 }}>
            {ar
              ? 'نقص في بيانات العقار: حساب بنكي مكتمل لمستفيد شيكات الإيجار (الاسم، البنك، رقم الحساب/IBAN). أكمله قبل التأجير أو التجديد حتى يظهر الاسم للمستأجر عند تحرير الشيكات.'
              : 'Property data gap: complete rent cheque payee bank account (name, bank, account/IBAN) before leasing or renewing so the tenant sees the payee when writing cheques.'}
          </p>
          <p style={{ margin: '0.65rem 0 0' }}>
            <Link className="button button--quiet button--sm" href="/owner/accounting?tab=settings">
              {ar ? 'إكمال الحساب البنكي من الحسابات' : 'Complete bank account in Accounting'}
            </Link>
          </p>
        </div>
      ) : null}

      {isTenant &&
      showCreateForm &&
      terms.paymentMethod === 'cheque' &&
      !(
        context.rentChequePayee.accountName.trim() ||
        (terms.chequeAccountName ?? '').trim()
      ) ? (
        <div className="notice notice--warning" role="status">
          {ar
            ? 'اسم مستفيد الشيكات غير ظاهر بعد — بانتظار إكمال المالك للحساب البنكي للعقار. يمكنك متابعة بقية الحقول، والإرسال يتوقف حتى يكتمل الاسم.'
            : 'Cheque payee name is not available yet — waiting for the landlord to complete the property bank account. You can fill other fields; submit waits until the payee name is set.'}
        </div>
      ) : null}

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

      {isTenant ? (
        <section className="card lease-renewal__summary" aria-labelledby="renewal-prev-title">
          <h2 id="renewal-prev-title">{ar ? 'تجديد الإيجار' : 'Lease renewal'}</h2>
          <p className="muted">
            {place} · {ar ? 'ينتهي الحالي' : 'Current ends'} {context.lease.endsOn}
          </p>
        </section>
      ) : (
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
      )}

      <LeaseContractForm
        key={`${context.lease.id}:${restoredDraft ? 'restored' : 'seed'}`}
        units={[context.unit]}
        tenants={[context.tenant]}
        canSign
        locale={locale}
        busy={busy || formBlocked || (needsEarlyException && !earlyExceptionAck)}
        formError={error}
        bankAccounts={bankAccounts}
        propertyId={context.property.id}
        lockTenantName
        lockStartsOn
        renewalMode
        tenantRenewalSlim={isTenant}
        previousMeters={isTenant ? null : context.previousMeters}
        tenantFromDirectory={!isTenant}
        municipalAfterHandover
        initialTenant={context.initialTenant}
        initialTerms={terms}
        {...(isTenant
          ? {}
          : {
              requirements,
              onRequirementsChange: setRequirements,
            })}
        heading={
          isTenant
            ? ar
              ? 'طلب تجديد الإيجار'
              : 'Lease renewal request'
            : ar
              ? 'بيانات عقد التجديد'
              : 'Renewal contract details'
        }
        submitLabel={
          isTenant
            ? ar
              ? 'إرسال طلب التجديد للمالك'
              : 'Send renewal request to landlord'
            : pendingRenewal && editingPending
              ? ar
                ? 'حفظ التعديلات وإرسال الملحق'
                : 'Save edits and send addendum'
              : ar
                ? 'إنشاء ملحق التجديد'
                : 'Create renewal addendum'
        }
        footnote={
          isTenant
            ? ar
              ? 'بعد الإرسال يراجع المالك المسودة ثم يرسلها إليك للتوقيع ورفع المستندات إن لزم.'
              : 'After submit the landlord reviews the draft, then sends it to you to sign and upload documents if needed.'
            : pendingRenewal && editingPending
              ? ar
                ? 'الحفظ يلغي الملحق غير المكتمل ويستبدله بهذه الحقول، ثم يُرسل للمستأجر للتوقيع.'
                : 'Saving voids the incomplete addendum, replaces it with these fields, then sends it to the tenant to sign.'
              : ar
                ? 'بعد الإنشاء يُرسل الملحق فوراً إلى المستأجر للتوقيع ورفع المستندات المطلوبة. لن يتغير العقد الحالي حتى يكتمل توقيع الطرفين. الشيكات تُكتب بالاسم الظاهر من الحساب البنكي.'
                : 'On create, the addendum is sent to the tenant immediately for e-sign and required documents. The current lease stays unchanged until both parties have signed. Cheques use the bank-account payee name.'
        }
        lead={
          isTenant ? undefined : (
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
          )
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
        </>
      ) : null}
    </div>
  );
}
