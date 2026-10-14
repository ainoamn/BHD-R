'use client';

import { useState, useTransition } from 'react';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  PAYMENT_METHOD_LABEL,
  minorOf,
  type PaymentMethod,
} from '@/components/owner-tenant-requests';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { RentCollectionLease, RentCollectionView } from '@/lib/rent-collection-neon';
import {
  rentDocHref,
  rentDocKindsOf,
  rentMonthLabel,
  type RentDocSubject,
} from '@/lib/rent-documents';
import { tenantRequestErrorText } from '@/lib/tenant-requests-shared';

function leaseLabel(lease: RentCollectionLease, ar: boolean): string {
  return [
    ar ? lease.propertyNameAr : lease.propertyNameEn || lease.propertyNameAr,
    lease.unitCode,
    lease.tenantName,
    lease.contractReference,
  ]
    .filter(Boolean)
    .join(' · ');
}

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

function majorOf(minor: string, currency: string): string {
  const units = currencyMinorUnits[currency as CurrencyCode] ?? 3;
  return (Number(minor) / 10 ** units).toFixed(units);
}

function dayOf(value: string, ar: boolean): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(ar ? 'ar-OM' : 'en-GB', { timeZone: 'UTC', dateStyle: 'medium' });
}

function SubjectRow({
  leaseId,
  subject,
  currency,
  locale,
  canRecord,
}: {
  leaseId: string;
  subject: RentDocSubject;
  currency: string;
  locale: 'ar' | 'en';
  canRecord: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(majorOf(subject.outstandingMinor, currency));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; href: string } | null>(null);
  const money = (minor: string) => formatMoney(minor, currency, locale);
  const recordable = canRecord && subject.outstandingMinor !== '0' && subject.kind !== 'cheque';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountMinor = minorOf(amount, currency as CurrencyCode);
    if (amountMinor === '0' || BigInt(amountMinor) > BigInt(subject.outstandingMinor)) {
      setError(tenantRequestErrorText('tenant_charge_invalid', ar));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ receiptNumber: string; receiptHref: string }>(
        '/api/owner/rent-receipts',
        {
          method: 'POST',
          body: JSON.stringify({
            leaseId,
            key: subject.key,
            amountMinor,
            method,
            reference: reference.trim() || undefined,
            receivedOn,
          }),
        },
      );
      setDone({ number: result.receiptNumber, href: result.receiptHref });
      setOpen(false);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rent-collect__item${subject.settled ? ' is-paid' : ''}`}>
      <div className="rent-collect__main">
        <strong>{ar ? subject.label.ar : subject.label.en}</strong>
        <span className="muted">
          {ar ? 'عن شهر ' : 'For '}
          {rentMonthLabel(subject, ar)} · {ar ? 'يستحق ' : 'due '}
          {dayOf(subject.dueOn, ar)}
        </span>
      </div>
      <dl className="rent-collect__nums">
        <div>
          <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
          <dd>{money(subject.amountMinor)}</dd>
        </div>
        <div>
          <dt>{ar ? 'المدفوع' : 'Paid'}</dt>
          <dd>{subject.paidMinor !== '0' ? money(subject.paidMinor) : '—'}</dd>
        </div>
        <div>
          <dt>{ar ? 'المتبقي' : 'Balance'}</dt>
          <dd>{money(subject.outstandingMinor)}</dd>
        </div>
      </dl>
      <span className={`tenant-status${subject.settled ? ' tenant-status--good' : ''}`}>
        {ar ? subject.status.ar : subject.status.en}
      </span>
      <div className="rent-collect__actions">
        {rentDocKindsOf(subject).map((kind) => (
          <Link
            key={kind}
            className="button button--quiet button--tiny"
            href={rentDocHref('owner', leaseId, subject.key, kind)}
            prefetch={false}
          >
            {kind === 'receipt'
              ? ar
                ? '🧾 الإيصال'
                : '🧾 Receipt'
              : ar
                ? '📄 الفاتورة'
                : '📄 Invoice'}
          </Link>
        ))}
        {recordable ? (
          <button
            type="button"
            className="button button--primary button--tiny"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {ar ? '＋ تسجيل قبض' : '＋ Record payment'}
          </button>
        ) : null}
      </div>
      {open ? (
        <form className="rent-collect__form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>
              {ar ? 'المبلغ المستلم' : 'Amount received'} ({currency})
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
            <span>{ar ? 'طريقة السداد' : 'Method'}</span>
            <select
              className="input"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((item) => (
                <option key={item} value={item}>
                  {ar ? PAYMENT_METHOD_LABEL[item].ar : PAYMENT_METHOD_LABEL[item].en}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              {ar ? 'المرجع (رقم التحويل أو الشيك)' : 'Reference (transfer or cheque No.)'}
            </span>
            <input
              className="input"
              dir="ltr"
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label>
            <span>{ar ? 'تاريخ الاستلام' : 'Received on'}</span>
            <input
              className="input"
              type="date"
              dir="ltr"
              required
              max={today()}
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </label>
          <div className="rent-collect__form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy
                ? ar
                  ? 'جارٍ التسجيل…'
                  : 'Recording…'
                : ar
                  ? 'تسجيل وإصدار الإيصال'
                  : 'Record and issue receipt'}
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="notice notice--success" role="status">
          {ar
            ? `صدر إيصال القبض ${done.number} وأُرسل للمستأجر بالبريد. `
            : `Receipt ${done.number} issued and emailed to the tenant. `}
          <Link href={done.href} prefetch={false}>
            {ar ? 'فتح الإيصال' : 'Open the receipt'}
          </Link>
        </p>
      ) : null}
    </li>
  );
}

/**
 * Rent collection: every installment and bill of a lease, with what is paid and left, the signed
 * receipt and demand invoice of each, and recording a payment (which emails the tenant the receipt).
 */
export function OwnerRentCollection({
  locale,
  view,
  canRecord,
}: {
  locale: 'ar' | 'en';
  view: RentCollectionView;
  canRecord: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const selected = view.selected;
  if (!view.leases.length || !selected) {
    return (
      <p className="dash-alerts__empty">
        {ar ? 'لا عقود إيجار لتحصيل أقساطها بعد.' : 'No leases to collect rent on yet.'}
      </p>
    );
  }
  const { lease, subjects } = selected;
  const sum = (pick: (subject: RentDocSubject) => string) =>
    subjects
      .filter((subject) => !subject.outsideTotal)
      .reduce((total, subject) => total + BigInt(pick(subject)), 0n)
      .toString();
  return (
    <div className="rent-collect">
      <label className="rent-collect__lease">
        <span>
          {ar
            ? 'العقد (العقار · الوحدة · المستأجر · رقم العقد)'
            : 'Lease (property · unit · tenant · contract)'}
        </span>
        <select
          className="input"
          value={lease.id}
          onChange={(event) =>
            router.push(`/owner/tenant-requests?tab=rent&lease=${event.target.value}`)
          }
        >
          {view.leases.map((item) => (
            <option key={item.id} value={item.id}>
              {leaseLabel(item, ar)}
            </option>
          ))}
        </select>
      </label>
      <dl className="rent-collect__totals">
        <div>
          <dt>{ar ? 'إجمالي الأقساط والفواتير' : 'Installments and bills'}</dt>
          <dd>
            {formatMoney(
              sum((subject) => subject.amountMinor),
              lease.currency,
              locale,
            )}
          </dd>
        </div>
        <div className="is-good">
          <dt>{ar ? 'المحصّل' : 'Collected'}</dt>
          <dd>
            {formatMoney(
              sum((subject) => subject.paidMinor),
              lease.currency,
              locale,
            )}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'المتبقي' : 'Outstanding'}</dt>
          <dd>
            {formatMoney(
              sum((subject) => subject.outstandingMinor),
              lease.currency,
              locale,
            )}
          </dd>
        </div>
      </dl>
      <p className="muted">
        {ar
          ? 'سجّل كل دفعة يستلمها المكتب (نقداً أو تحويلاً أو بطاقة أو شيكاً) فيصدر إيصال قبض موقّع إلكترونياً ويصل المستأجر بالبريد، وتبقى فاتورة المطالبة متاحة لما لم يُسدَّد.'
          : 'Record every payment the office receives (cash, transfer, card or cheque): an electronically signed receipt is issued and emailed to the tenant, and the demand invoice stays available for what is unpaid.'}
      </p>
      {subjects.length ? (
        <ul className="rent-collect__list">
          {subjects.map((subject) => (
            <SubjectRow
              key={`${lease.id}:${subject.key}`}
              leaseId={lease.id}
              subject={subject}
              currency={lease.currency}
              locale={locale}
              canRecord={canRecord}
            />
          ))}
        </ul>
      ) : (
        <p className="dash-alerts__empty">
          {ar ? 'لا أقساط مسجلة على هذا العقد.' : 'No installments recorded on this lease.'}
        </p>
      )}
    </div>
  );
}
