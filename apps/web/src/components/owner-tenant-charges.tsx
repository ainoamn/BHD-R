'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { CurrencyCode } from '@bhd-r/contracts';
import {
  PAYMENT_METHOD_LABEL,
  minorOf,
  type PaymentMethod,
} from '@/components/owner-tenant-requests';
import { requestStamp } from '@/components/tenant-requests-list';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { ChargeableLease, TenantChargeView } from '@/lib/tenant-charges-neon';
import { CHARGE_CATEGORIES, chargeLabel, type ChargeCategory } from '@/lib/tenant-charges-shared';
import { tenantRequestErrorText } from '@/lib/tenant-requests-shared';
import { domainStatusLabel } from '@/lib/ui-labels';

function leaseLabel(lease: ChargeableLease, ar: boolean): string {
  return [
    ar ? lease.propertyNameAr : lease.propertyNameEn || lease.propertyNameAr,
    lease.unitCode,
    lease.tenantName,
  ]
    .filter(Boolean)
    .join(' · ');
}

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

function ChargeRow({
  charge,
  locale,
  canRecordPayments,
}: {
  charge: TenantChargeView;
  locale: 'ar' | 'en';
  canRecordPayments: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = ['issued', 'partially_paid', 'overdue'].includes(charge.status);
  const left = BigInt(charge.totalMinor) - BigInt(charge.paidMinor);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(`/api/owner/tenant-charges/${encodeURIComponent(charge.id)}`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      });
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tenant-request">
      <header className="tenant-request__head">
        <div>
          <strong>{chargeLabel(charge.category, ar)}</strong>
          <span className="muted">
            {' · '}
            <bdi>{charge.number}</bdi>
            {' · '}
            {requestStamp(charge.issuedOn, ar)}
          </span>
        </div>
        <span
          className={`tenant-status${charge.status === 'paid' ? ' tenant-status--good' : open && charge.dueOn < today() ? ' tenant-status--bad' : open ? ' tenant-status--warn' : ''}`}
        >
          {domainStatusLabel(charge.status, ar)}
        </span>
      </header>
      <dl className="tenant-request__facts">
        <div>
          <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
          <dd>{charge.tenantName ?? '—'}</dd>
        </div>
        <div>
          <dt>{ar ? 'العقار' : 'Property'}</dt>
          <dd>
            {[
              ar ? charge.propertyNameAr : charge.propertyNameEn || charge.propertyNameAr,
              charge.unitCode,
            ]
              .filter(Boolean)
              .join(' · ')}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
          <dd>{formatMoney(charge.totalMinor, charge.currency, locale)}</dd>
        </div>
        {charge.paidMinor !== '0' ? (
          <div>
            <dt>{ar ? 'المدفوع' : 'Paid'}</dt>
            <dd>{formatMoney(charge.paidMinor, charge.currency, locale)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'الاستحقاق' : 'Due'}</dt>
          <dd>{requestStamp(charge.dueOn, ar)}</dd>
        </div>
      </dl>
      {charge.description ? <p className="tenant-request__text">{charge.description}</p> : null}
      {open && left > 0n && canRecordPayments ? (
        <div className="tenant-request__charge-pay">
          <select
            className="input"
            value={method}
            aria-label={ar ? 'طريقة السداد' : 'Payment method'}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((item) => (
              <option key={item} value={item}>
                {ar ? PAYMENT_METHOD_LABEL[item].ar : PAYMENT_METHOD_LABEL[item].en}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--primary button--tiny"
            disabled={busy}
            onClick={() => void pay()}
          >
            {busy
              ? ar
                ? 'جارٍ التسجيل…'
                : 'Recording…'
              : ar
                ? `تسجيل سداد ${formatMoney(left.toString(), charge.currency, locale)}`
                : `Record ${formatMoney(left.toString(), charge.currency, locale)} paid`}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Charges on tenants: electricity and water bills, maintenance they pay for, damage and other
 * amounts. Each is an invoice on the lease that the tenant sees in their arrears.
 */
export function OwnerTenantCharges({
  locale,
  charges,
  leases,
  canCreate,
  canRecordPayments,
}: {
  locale: 'ar' | 'en';
  charges: TenantChargeView[];
  leases: ChargeableLease[];
  canCreate: boolean;
  canRecordPayments: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [leaseId, setLeaseId] = useState(leases[0]?.id ?? '');
  const [category, setCategory] = useState<ChargeCategory>('electricity');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState(today());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lease = leases.find((item) => item.id === leaseId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!lease) return;
    const amountMinor = minorOf(amount, lease.currency as CurrencyCode);
    if (amountMinor === '0') {
      setError(tenantRequestErrorText('tenant_charge_invalid', ar));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await browserNextMutation<{ number: string }>('/api/owner/tenant-charges', {
        method: 'POST',
        body: JSON.stringify({
          leaseId: lease.id,
          category,
          amountMinor,
          dueOn,
          description: description.trim() || undefined,
        }),
      });
      setDone(result.number);
      setAmount('');
      setDescription('');
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="owner-charges">
      {canCreate ? (
        <form
          className="owner-charges__form tenant-request-form"
          onSubmit={(event) => void submit(event)}
        >
          <h2>{ar ? 'مطالبة جديدة على مستأجر' : 'New charge on a tenant'}</h2>
          {leases.length ? (
            <>
              <label>
                <span>
                  {ar ? 'العقد (العقار · الوحدة · المستأجر)' : 'Lease (property · unit · tenant)'}
                </span>
                <select
                  className="input"
                  value={leaseId}
                  onChange={(event) => setLeaseId(event.target.value)}
                >
                  {leases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {leaseLabel(item, ar)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="owner-charges__row">
                <label>
                  <span>{ar ? 'النوع' : 'Category'}</span>
                  <select
                    className="input"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as ChargeCategory)}
                  >
                    {CHARGE_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {chargeLabel(item, ar)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>
                    {ar ? 'المبلغ' : 'Amount'} ({lease?.currency ?? 'OMR'})
                  </span>
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                  />
                </label>
                <label>
                  <span>{ar ? 'تاريخ الاستحقاق' : 'Due on'}</span>
                  <input
                    className="input"
                    type="date"
                    dir="ltr"
                    required
                    min={today()}
                    value={dueOn}
                    onChange={(event) => setDueOn(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>{ar ? 'الوصف (يظهر للمستأجر)' : 'Description (the tenant sees it)'}</span>
                <input
                  className="input"
                  maxLength={300}
                  value={description}
                  placeholder={
                    ar ? 'مثال: فاتورة كهرباء شهر سبتمبر' : 'e.g. September electricity bill'
                  }
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              {done ? (
                <p className="notice notice--success" role="status">
                  {ar
                    ? `صدرت المطالبة ${done} وتظهر للمستأجر في كشف حسابه ومتأخراته عند حلول موعدها.`
                    : `Charge ${done} was issued; the tenant sees it in their statement and arrears once due.`}
                </p>
              ) : null}
              <div className="tenant-request-form__actions">
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy
                    ? ar
                      ? 'جارٍ الإصدار…'
                      : 'Issuing…'
                    : ar
                      ? 'إصدار المطالبة'
                      : 'Issue charge'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">
              {ar ? 'لا عقود إيجار سارية لإصدار مطالبات عليها.' : 'No active leases to charge.'}
            </p>
          )}
        </form>
      ) : null}
      <h2>{ar ? 'آخر المطالبات' : 'Recent charges'}</h2>
      {charges.length ? (
        <ul className="tenant-requests">
          {charges.map((charge) => (
            <ChargeRow
              key={charge.id}
              charge={charge}
              locale={locale}
              canRecordPayments={canRecordPayments}
            />
          ))}
        </ul>
      ) : (
        <p className="dash-alerts__empty">
          {ar ? 'لم تصدر مطالبات على المستأجرين بعد.' : 'No charges on tenants yet.'}
        </p>
      )}
    </div>
  );
}
