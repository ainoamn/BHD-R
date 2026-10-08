'use client';

import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import type {
  AdjustmentRecurrence,
  AdjustmentScope,
  DepositMethod,
  LeaseTerms,
  PaymentFrequency,
  PaymentMethod,
} from '@/lib/lease-terms';

export type LeaseTenantDetails = {
  entityType: 'person' | 'company';
  nameAr: string;
  nameEn: string | null;
  civilId: string | null;
  passport: string | null;
  nationality: string | null;
  crNumber: string | null;
  crExpiry: string | null;
  signatoryName: string | null;
  signatoryCivilId: string | null;
  phone: string | null;
  email: string | null;
};

type Pair = [string, string];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, Pair> = {
  cheque: ['شيك', 'Cheque'],
  cash: ['نقداً', 'Cash'],
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
};

export const FREQUENCY_LABELS: Record<PaymentFrequency, Pair> = {
  monthly: ['شهرياً', 'Monthly'],
  bimonthly: ['كل شهرين', 'Every 2 months'],
  quarterly: ['كل 3 أشهر', 'Every 3 months'],
  semiannual: ['كل 6 أشهر', 'Every 6 months'],
  annual: ['سنوياً', 'Yearly'],
};

export const RECURRENCE_LABELS: Record<AdjustmentRecurrence, Pair> = {
  one_time: ['مرة واحدة', 'Once'],
  with_renewal: ['مع التجديد', 'With renewal'],
  every_3_months: ['كل 3 أشهر', 'Every 3 months'],
  monthly: ['شهرياً', 'Monthly'],
};

export const SCOPE_LABELS: Record<AdjustmentScope, Pair> = {
  contract_end: ['حتى نهاية العقد', 'Until contract end'],
  one_year: ['سنة', 'One year'],
  custom_months: ['مدة مخصصة', 'Custom period'],
};

export const DEPOSIT_METHOD_LABELS: Record<DepositMethod, Pair> = {
  cash: ['نقداً', 'Cash'],
  cheque: ['شيك', 'Cheque'],
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
  other: ['أخرى', 'Other'],
};

export function pick(pair: Pair, ar: boolean): string {
  return ar ? pair[0] : pair[1];
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function periodText(months: number, extraDays: number, ar: boolean): string {
  if (ar) {
    const m = `${months} شهر`;
    return extraDays ? `${m} و ${extraDays} يوم` : m;
  }
  const m = `${months} month${months === 1 ? '' : 's'}`;
  return extraDays ? `${m} and ${extraDays} day${extraDays === 1 ? '' : 's'}` : m;
}

function Money({
  minor,
  currency,
  locale,
}: {
  minor: number;
  currency: string;
  locale: 'ar' | 'en';
}) {
  return <span dir="ltr">{formatMoney(String(Math.round(minor)), currency, locale)}</span>;
}

/** Financial summary in the order of the original contract screen (rent, VAT, fees, discounts, total). */
export function LeaseTotalsSummary({ terms, locale }: { terms: LeaseTerms; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const { totals, currency } = terms;
  const money = (minor: number) => <Money minor={minor} currency={currency} locale={locale} />;
  const lines: Array<{ label: string; value: number; tone?: 'minus' | 'total' | 'info' }> = [
    { label: ar ? '١ إجمالي الإيجارات' : '1 Total rent', value: totals.rentMinor },
  ];
  if (terms.vat.enabled) {
    lines.push({
      label: ar
        ? `٢ الضريبة المضافة ${percent(terms.vat.rateBasisPoints)} (${terms.vat.mode === 'with_rent' ? 'مع الإيجار' : 'شيكات منفصلة'})`
        : `2 VAT ${percent(terms.vat.rateBasisPoints)} (${terms.vat.mode === 'with_rent' ? 'with rent' : 'separate cheques'})`,
      value: totals.vatMinor,
    });
  }
  if (terms.municipalityFee.enabled) {
    lines.push({
      label: ar ? '٣ رسوم البلدية 3%' : '3 Municipality fee 3%',
      value: totals.municipalityFeeMinor,
    });
  }
  if (totals.registrationFeeMinor) {
    lines.push({
      label: ar ? 'رسوم تسجيل العقد' : 'Registration fee',
      value: totals.registrationFeeMinor,
    });
  }
  if (terms.otherTax) {
    lines.push({
      label: `${terms.otherTax.name} ${percent(terms.otherTax.rateBasisPoints)}`,
      value: totals.otherTaxMinor,
    });
  }
  if (totals.additionsMinor) {
    lines.push({ label: ar ? 'المبالغ الإضافية' : 'Extra charges', value: totals.additionsMinor });
  }
  if (totals.graceDiscountMinor) {
    lines.push({
      label: ar
        ? `٤ خصم فترة السماح (${terms.graceDays} يوم)`
        : `4 Grace discount (${terms.graceDays} days)`,
      value: -totals.graceDiscountMinor,
      tone: 'minus',
    });
  }
  if (totals.discountsMinor) {
    lines.push({
      label: ar ? 'الخصومات' : 'Discounts',
      value: -totals.discountsMinor,
      tone: 'minus',
    });
  }
  lines.push({
    label: ar ? '٥ إجمالي العقد' : '5 Contract total',
    value: totals.grandTotalMinor,
    tone: 'total',
  });
  if (totals.depositMinor) {
    lines.push({
      label: ar ? 'التأمين (يُحصَّل منفصلاً ويُسترد)' : 'Deposit (separate, refundable)',
      value: totals.depositMinor,
      tone: 'info',
    });
  }
  return (
    <dl className="lcf-totals">
      {lines.map((line) => (
        <div key={line.label} className={line.tone ? `lcf-totals__${line.tone}` : undefined}>
          <dt>{line.label}</dt>
          <dd>
            {line.tone === 'minus' ? '− ' : ''}
            {money(Math.abs(line.value))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  const shown = items.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!shown.length) return null;
  return (
    <dl className="lcf-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Full read-only view of a stored lease: terms, tenant, schedules, extras and totals. */
export function LeaseTermsView({
  terms,
  tenant,
  locale,
}: {
  terms: LeaseTerms;
  tenant: LeaseTenantDetails | null;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const currency = terms.currency;
  const money = (minor: number) => <Money minor={minor} currency={currency} locale={locale} />;
  const ltr = (value: string | null) => (value ? <span dir="ltr">{value}</span> : null);
  const use = (value: 'residential' | 'commercial') =>
    value === 'commercial' ? (ar ? 'تجاري' : 'Commercial') : ar ? 'سكني' : 'Residential';
  const isCheque = terms.paymentMethod === 'cheque';

  return (
    <div className="lcf-view">
      <section>
        <h4>{ar ? 'بيانات العقد' : 'Contract terms'}</h4>
        <Facts
          items={[
            [ar ? 'نوع العقد' : 'Contract type', use(terms.contractType)],
            [ar ? 'نوع الاستعمال' : 'Usage', use(terms.usageType)],
            [ar ? 'رقم استمارة العقد البلدي' : 'Municipal form no.', ltr(terms.municipalFormNo)],
            [ar ? 'رقم العقد البلدي' : 'Municipal contract no.', ltr(terms.municipalContractNo)],
            [ar ? 'الإيجار الشهري' : 'Monthly rent', money(terms.monthlyRentMinor)],
            [
              ar ? 'طريقة الاحتساب' : 'Rent basis',
              terms.rentCalcMode === 'per_meter' && terms.rentPerSqmMinor !== null
                ? ar
                  ? `بالمتر: ${terms.rentAreaSqm} م² × ${formatMoney(String(terms.rentPerSqmMinor), currency, locale)}`
                  : `Per m²: ${terms.rentAreaSqm} m² × ${formatMoney(String(terms.rentPerSqmMinor), currency, locale)}`
                : ar
                  ? 'إيجار كامل'
                  : 'Full rent',
            ],
            [ar ? 'المدة' : 'Term', periodText(terms.months, terms.extraDays, ar)],
            [ar ? 'من' : 'From', ltr(terms.startsOn)],
            [ar ? 'إلى' : 'To', ltr(terms.endsOn)],
            [ar ? 'تاريخ استلام الوحدة' : 'Handover', ltr(terms.handoverOn)],
            [
              ar ? 'فترة السماح' : 'Grace period',
              terms.graceDays ? (
                <>
                  {terms.graceDays} {ar ? 'يوم' : 'days'} · {money(terms.graceAmountMinor)}
                </>
              ) : null,
            ],
            [ar ? 'يوم دفع الإيجار' : 'Payment day', String(terms.paymentDay)],
            [
              ar ? 'طريقة الدفع' : 'Payment method',
              pick(PAYMENT_METHOD_LABELS[terms.paymentMethod], ar),
            ],
            [ar ? 'دورية الدفع' : 'Frequency', pick(FREQUENCY_LABELS[terms.paymentFrequency], ar)],
            [ar ? 'بنك الشيكات' : 'Cheque bank', terms.chequeBankName],
            [ar ? 'اسم الحساب' : 'Account name', terms.chequeAccountName],
            [
              ar ? 'الضريبة المضافة' : 'VAT',
              terms.vat.enabled
                ? `${percent(terms.vat.rateBasisPoints)} · ${
                    terms.vat.mode === 'with_rent'
                      ? ar
                        ? 'مع الإيجار الشهري'
                        : 'with monthly rent'
                      : ar
                        ? `${terms.vat.chequeCount} شيك منفصل`
                        : `${terms.vat.chequeCount} separate cheque(s)`
                  }`
                : ar
                  ? 'غير مشمول'
                  : 'Not applicable',
            ],
            [
              ar ? 'قراءة عداد الكهرباء' : 'Electricity reading',
              ltr(terms.meters.electricityReading),
            ],
            [ar ? 'قراءة عداد الماء' : 'Water reading', ltr(terms.meters.waterReading)],
          ]}
        />
      </section>

      {tenant ? (
        <section>
          <h4>{ar ? 'المستأجر' : 'Tenant'}</h4>
          <Facts
            items={[
              [
                ar ? 'نوع الجهة' : 'Lessee type',
                tenant.entityType === 'company' ? (ar ? 'شركة' : 'Company') : ar ? 'شخص' : 'Person',
              ],
              [ar ? 'الاسم (عربي)' : 'Name (Arabic)', tenant.nameAr],
              [ar ? 'الاسم بالإنجليزية' : 'Name (English)', tenant.nameEn],
              [ar ? 'الرقم المدني' : 'Civil ID', ltr(tenant.civilId)],
              [ar ? 'رقم الجواز' : 'Passport', ltr(tenant.passport)],
              [ar ? 'الجنسية' : 'Nationality', tenant.nationality],
              [ar ? 'السجل التجاري' : 'CR no.', ltr(tenant.crNumber)],
              [ar ? 'انتهاء السجل التجاري' : 'CR expiry', ltr(tenant.crExpiry)],
              [ar ? 'المفوض بالتوقيع' : 'Authorized signatory', tenant.signatoryName],
              [ar ? 'الرقم المدني للمفوض' : 'Signatory civil ID', ltr(tenant.signatoryCivilId)],
              [ar ? 'الجوال' : 'Mobile', ltr(tenant.phone)],
              [ar ? 'البريد الإلكتروني' : 'Email', ltr(tenant.email)],
            ]}
          />
        </section>
      ) : null}

      <section>
        <h4>{ar ? 'جدول الدفع' : 'Payment schedule'}</h4>
        <div className="data-table-wrap">
          <table className="data-table lcf-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{ar ? 'الفترة' : 'Period'}</th>
                <th>{ar ? 'تاريخ الاستحقاق' : 'Due'}</th>
                <th>{ar ? 'الإيجار' : 'Rent'}</th>
                {terms.vat.enabled && terms.vat.mode === 'with_rent' ? (
                  <th>{ar ? 'الضريبة' : 'VAT'}</th>
                ) : null}
                <th>{ar ? 'الإجمالي' : 'Total'}</th>
                {isCheque ? <th>{ar ? 'رقم الشيك' : 'Cheque no.'}</th> : null}
                {isCheque ? <th>{ar ? 'البنك' : 'Bank'}</th> : null}
              </tr>
            </thead>
            <tbody>
              {terms.schedule.map((row) => (
                <tr key={row.index}>
                  <td>{row.index}</td>
                  <td dir="ltr">
                    {row.periodFrom && row.periodTo ? `${row.periodFrom} → ${row.periodTo}` : '—'}
                    {row.extraDays ? (ar ? ' (أيام إضافية)' : ' (extra days)') : ''}
                  </td>
                  <td dir="ltr">{row.dueOn}</td>
                  <td>{money(row.rentMinor)}</td>
                  {terms.vat.enabled && terms.vat.mode === 'with_rent' ? (
                    <td>{money(row.vatMinor)}</td>
                  ) : null}
                  <td>{money(row.totalMinor)}</td>
                  {isCheque ? <td dir="ltr">{row.chequeNumber ?? '—'}</td> : null}
                  {isCheque ? <td>{row.bankName ?? '—'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {terms.vatCheques.length ? (
        <section>
          <h4>{ar ? 'شيكات الضريبة المضافة' : 'VAT cheques'}</h4>
          <div className="data-table-wrap">
            <table className="data-table lcf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{ar ? 'تاريخ الاستحقاق' : 'Due'}</th>
                  <th>{ar ? 'المبلغ' : 'Amount'}</th>
                  <th>{ar ? 'رقم الشيك' : 'Cheque no.'}</th>
                </tr>
              </thead>
              <tbody>
                {terms.vatCheques.map((row) => (
                  <tr key={row.index}>
                    <td>{row.index}</td>
                    <td dir="ltr">{row.dueOn}</td>
                    <td>{money(row.amountMinor)}</td>
                    <td dir="ltr">{row.chequeNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {terms.adjustments.length ? (
        <section>
          <h4>{ar ? 'مبالغ إضافية / خصومات' : 'Extra charges & discounts'}</h4>
          <div className="data-table-wrap">
            <table className="data-table lcf-table">
              <thead>
                <tr>
                  <th>{ar ? 'النوع' : 'Type'}</th>
                  <th>{ar ? 'البند' : 'Item'}</th>
                  <th>{ar ? 'المبلغ' : 'Amount'}</th>
                  <th>{ar ? 'التكرار' : 'Recurrence'}</th>
                  <th>{ar ? 'المدة' : 'Scope'}</th>
                  <th>{ar ? 'الإجمالي' : 'Line total'}</th>
                </tr>
              </thead>
              <tbody>
                {terms.adjustments.map((line, index) => (
                  <tr key={`${line.title}-${index}`}>
                    <td>
                      {line.kind === 'discount'
                        ? ar
                          ? 'خصم'
                          : 'Discount'
                        : ar
                          ? 'إضافة'
                          : 'Charge'}
                    </td>
                    <td>{line.title}</td>
                    <td>{money(line.amountMinor)}</td>
                    <td>{pick(RECURRENCE_LABELS[line.recurrence], ar)}</td>
                    <td>
                      {pick(SCOPE_LABELS[line.scope], ar)}
                      {line.months ? ` (${line.months})` : ''}
                    </td>
                    <td>
                      {line.kind === 'discount' && line.lineTotalMinor ? '− ' : ''}
                      {money(line.lineTotalMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {terms.totals.depositMinor || terms.depositItems.length ? (
        <section>
          <h4>{ar ? 'التأمين (الوديعة)' : 'Deposit'}</h4>
          <Facts
            items={[[ar ? 'مبلغ التأمين' : 'Deposit amount', money(terms.totals.depositMinor)]]}
          />
          {terms.depositItems.length ? (
            <ul className="lcf-list">
              {terms.depositItems.map((item, index) => (
                <li key={index}>
                  {pick(DEPOSIT_METHOD_LABELS[item.method], ar)} · {money(item.amountMinor)}
                  {item.reference ? (
                    <>
                      {' · '}
                      <span dir="ltr">{item.reference}</span>
                    </>
                  ) : null}
                  {item.bankName ? ` · ${item.bankName}` : ''}
                  {item.dueOn ? (
                    <>
                      {' · '}
                      <span dir="ltr">{item.dueOn}</span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section>
        <h4>{ar ? 'الملخص المالي' : 'Financial summary'}</h4>
        <LeaseTotalsSummary terms={terms} locale={locale} />
      </section>

      {terms.notes ? (
        <section>
          <h4>{ar ? 'ملاحظات' : 'Notes'}</h4>
          <p className="lcf-notes">{terms.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

export function parseLeaseTerms(json: string | null | undefined): LeaseTerms | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as LeaseTerms;
    return value && Array.isArray(value.schedule) && value.totals ? value : null;
  } catch {
    return null;
  }
}

export function parseTenantDetails(json: string | null | undefined): LeaseTenantDetails | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as LeaseTenantDetails;
    return value && typeof value.nameAr === 'string' ? value : null;
  } catch {
    return null;
  }
}
