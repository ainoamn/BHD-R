'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import { dateText, errorText, getJson } from '@/lib/badges-client';
import { formatMoney } from '@/lib/format';
import {
  DOCUMENT_LABELS,
  KIND_LABELS,
  NAME_MATCH_THRESHOLD,
  PAYMENT_LABELS,
  PERIOD_LABELS,
  SLOT_LABELS,
  STATUS_LABELS,
  VERIFICATION_KINDS,
  VERIFICATION_PERIODS,
  type ReviewQueueItem,
  type VerificationKind,
  type VerificationPeriod,
  type VerificationPlan,
} from '@/lib/verification-shared';

type Locale = 'ar' | 'en';
type Queue = { items: ReviewQueueItem[]; plans: VerificationPlan[] };

function minorToDecimal(minor: string): string {
  return (Number(minor || '0') / 1000).toFixed(3);
}

/** Site administration: review identity documents, record the fee, approve or reject, set prices. */
export function VerificationReview({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await getJson<Queue>('/api/site-admin/verification'));
      setError(null);
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  }, [ar]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!queue) {
    return (
      <section className="verification-admin">
        {error ? (
          <p className="form-error">{error}</p>
        ) : (
          <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        )}
      </section>
    );
  }

  const items = queue.items.filter((item) => show === 'all' || item.status === 'submitted');
  const openCount = queue.items.filter((item) => item.status === 'submitted').length;

  return (
    <section className="verification-admin">
      <header className="badges-hero">
        <div>
          <p className="eyebrow">{ar ? 'إدارة الموقع' : 'Site administration'}</p>
          <h1>{ar ? 'توثيق الحسابات' : 'Account verification'}</h1>
          <p className="muted">
            {ar
              ? 'راجع المستندات وطابق الاسم، سجّل سداد الرسوم أو أعفِ منها، ثم اعتمد الطلب لتظهر علامة التوثيق بجانب اسم صاحبه في كل الصفحات.'
              : 'Review documents, match the name, record the fee, then approve so the tick shows everywhere.'}
          </p>
        </div>
      </header>

      <PlansEditor locale={locale} plans={queue.plans} onSaved={load} />

      <div className="badges-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={show === 'open'}
          className={show === 'open' ? 'is-active' : undefined}
          onClick={() => setShow('open')}
        >
          {ar ? `قيد المراجعة (${openCount})` : `Open (${openCount})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={show === 'all'}
          className={show === 'all' ? 'is-active' : undefined}
          onClick={() => setShow('all')}
        >
          {ar ? 'كل الطلبات' : 'All requests'}
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {items.length === 0 ? (
        <p className="muted badges-empty">{ar ? 'لا توجد طلبات.' : 'No requests.'}</p>
      ) : (
        <ul className="verification-queue">
          {items.map((item) => (
            <ReviewItem
              key={item.id}
              item={item}
              locale={locale}
              open={openId === item.id}
              onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
              onChanged={load}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewItem({
  item,
  locale,
  open,
  onToggle,
  onChanged,
}: {
  item: ReviewQueueItem;
  locale: Locale;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [method, setMethod] = useState<'bank_transfer' | 'cash' | 'card' | 'other'>(
    'bank_transfer',
  );
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fee =
    item.feeMinor === '0'
      ? ar
        ? 'مجاناً'
        : 'Free'
      : formatMoney(item.feeMinor, item.currency, locale);
  const scoreOk = item.nameMatchScore >= NAME_MATCH_THRESHOLD;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(`/api/site-admin/verification/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await onChanged();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`verification-item is-${item.status}`}>
      <button
        type="button"
        className="verification-item__summary"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span dir="ltr" className="award-row__serial">
          {item.serial}
        </span>
        <strong>{item.subjectName}</strong>
        <span className="muted">{ar ? KIND_LABELS[item.kind].ar : KIND_LABELS[item.kind].en}</span>
        <span className={`badge-pill badge-pill--v-${item.status}`}>
          {ar ? STATUS_LABELS[item.status].ar : STATUS_LABELS[item.status].en}
        </span>
        <span className={`badge-pill badge-pill--pay-${item.paymentStatus}`}>
          {ar ? PAYMENT_LABELS[item.paymentStatus].ar : PAYMENT_LABELS[item.paymentStatus].en}
        </span>
        <span className={`name-score${scoreOk ? ' is-ok' : ' is-bad'}`}>
          {item.nameMatchScore}%
        </span>
        <span className="muted">{dateText(item.createdAt, ar)}</span>
      </button>
      {open ? (
        <div className="verification-item__body">
          <dl className="verification-item__facts">
            <div>
              <dt>{ar ? 'اسم الحساب' : 'Account name'}</dt>
              <dd>{item.accountName}</dd>
            </div>
            <div>
              <dt>{ar ? 'البريد' : 'Email'}</dt>
              <dd dir="ltr">{item.accountEmail}</dd>
            </div>
            {item.organizationName ? (
              <div>
                <dt>{ar ? 'المنشأة' : 'Organization'}</dt>
                <dd>{item.organizationName}</dd>
              </div>
            ) : null}
            <div>
              <dt>{ar ? 'الاسم في المستند (عربي)' : 'Legal name (Arabic)'}</dt>
              <dd>{item.legalNameAr || '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'الاسم في المستند (إنجليزي)' : 'Legal name (English)'}</dt>
              <dd dir="ltr">{item.legalNameEn || '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'المستند' : 'Document'}</dt>
              <dd>
                {ar ? DOCUMENT_LABELS[item.documentType].ar : DOCUMENT_LABELS[item.documentType].en}
                {item.documentLast4 ? ` ••${item.documentLast4}` : ''}
                {item.documentExpiresOn
                  ? ` · ${ar ? 'ينتهي' : 'expires'} ${dateText(item.documentExpiresOn, ar)}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المدة والرسوم' : 'Period & fee'}</dt>
              <dd>
                {ar ? PERIOD_LABELS[item.period].ar : PERIOD_LABELS[item.period].en} · {fee}
              </dd>
            </div>
            {item.renewalOf ? (
              <div>
                <dt>{ar ? 'النوع' : 'Type'}</dt>
                <dd>{ar ? 'تجديد' : 'Renewal'}</dd>
              </div>
            ) : null}
            {item.paymentReference ? (
              <div>
                <dt>{ar ? 'مرجع الدفع' : 'Payment ref'}</dt>
                <dd dir="ltr">{item.paymentReference}</dd>
              </div>
            ) : null}
            {item.verifiedUntil ? (
              <div>
                <dt>{ar ? 'موثّق حتى' : 'Verified until'}</dt>
                <dd>{dateText(item.verifiedUntil, ar)}</dd>
              </div>
            ) : null}
            {item.reviewNote ? (
              <div>
                <dt>{ar ? 'ملاحظة المراجعة' : 'Review note'}</dt>
                <dd>{item.reviewNote}</dd>
              </div>
            ) : null}
          </dl>
          <div className="verification-item__docs">
            {item.slots.map((slot) => (
              <a
                key={slot}
                href={`/api/account/verification/${item.id}/files/${slot}`}
                target="_blank"
                rel="noreferrer"
                className="doc-thumb"
              >
                <img
                  src={`/api/account/verification/${item.id}/files/${slot}`}
                  alt=""
                  loading="lazy"
                />
                <span>{ar ? SLOT_LABELS[slot].ar : SLOT_LABELS[slot].en}</span>
              </a>
            ))}
          </div>
          {item.status === 'submitted' ? (
            <div className="verification-item__actions">
              {item.paymentStatus === 'unpaid' ? (
                <fieldset>
                  <legend>{ar ? '١. تسجيل سداد الرسوم' : '1. Record the fee'}</legend>
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value as typeof method)}
                  >
                    <option value="bank_transfer">{ar ? 'تحويل بنكي' : 'Bank transfer'}</option>
                    <option value="cash">{ar ? 'نقداً' : 'Cash'}</option>
                    <option value="card">{ar ? 'بطاقة' : 'Card'}</option>
                    <option value="other">{ar ? 'أخرى' : 'Other'}</option>
                  </select>
                  <input
                    placeholder={ar ? 'رقم المرجع / الإيصال' : 'Reference / receipt no.'}
                    value={reference}
                    maxLength={120}
                    onChange={(event) => setReference(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={busy}
                    onClick={() =>
                      void send({ action: 'pay', method, reference: reference.trim() || null })
                    }
                  >
                    {ar ? 'تأكيد الاستلام' : 'Confirm received'}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    disabled={busy}
                    onClick={() =>
                      void send({ action: 'waive', reference: reference.trim() || null })
                    }
                  >
                    {ar ? 'إعفاء من الرسوم' : 'Waive'}
                  </button>
                </fieldset>
              ) : null}
              <fieldset>
                <legend>{ar ? '٢. القرار' : '2. Decision'}</legend>
                <label className="badges-editor__check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    {ar
                      ? 'راجعتُ المستندات بنفسي: الاسم يطابق اسم الحساب، والصورة الشخصية تطابق المستند، والمستند ساري.'
                      : 'I checked the documents: the name matches, the selfie matches and the document is valid.'}
                  </span>
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder={
                    ar
                      ? 'ملاحظة (مطلوبة عند الرفض، تظهر لصاحب الطلب)'
                      : 'Note (required to reject; shown to the applicant)'
                  }
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <div className="badges-grant__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy || !confirmed || item.paymentStatus === 'unpaid'}
                    onClick={() =>
                      void send({
                        action: 'approve',
                        nameConfirmed: true,
                        note: note.trim() || null,
                      })
                    }
                  >
                    {ar ? 'اعتماد التوثيق' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy || note.trim().length < 3}
                    onClick={() => void send({ action: 'reject', note: note.trim() })}
                  >
                    {ar ? 'رفض' : 'Reject'}
                  </button>
                </div>
                {item.paymentStatus === 'unpaid' ? (
                  <p className="muted">
                    {ar
                      ? 'الاعتماد متاح بعد تسجيل السداد أو الإعفاء.'
                      : 'Approve after the fee is recorded.'}
                  </p>
                ) : null}
              </fieldset>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PlansEditor({
  locale,
  plans,
  onSaved,
}: {
  locale: Locale;
  plans: VerificationPlan[];
  onSaved: () => Promise<void>;
}) {
  const ar = locale === 'ar';
  const initial = () =>
    Object.fromEntries(
      VERIFICATION_KINDS.flatMap((kind) =>
        VERIFICATION_PERIODS.map((period) => {
          const plan = plans.find((item) => item.kind === kind && item.period === period);
          return [
            `${kind}:${period}`,
            { price: plan ? minorToDecimal(plan.priceMinor) : '', active: plan?.active ?? false },
          ];
        }),
      ),
    ) as Record<string, { price: string; active: boolean }>;
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (kind: VerificationKind, period: VerificationPeriod) => {
    const key = `${kind}:${period}`;
    const row = draft[key]!;
    setBusy(key);
    setMessage(null);
    try {
      await browserNextMutation('/api/site-admin/verification', {
        method: 'PUT',
        body: JSON.stringify({ kind, period, price: row.price.trim() || '0', active: row.active }),
      });
      await onSaved();
      setMessage(ar ? 'حُفظت الرسوم.' : 'Fee saved.');
    } catch (caught) {
      setMessage(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="account-card">
      <h2>{ar ? 'رسوم التوثيق (ر.ع.)' : 'Verification fees (OMR)'}</h2>
      <table className="plans-table">
        <thead>
          <tr>
            <th>{ar ? 'النوع' : 'Kind'}</th>
            <th>{ar ? 'المدة' : 'Period'}</th>
            <th>{ar ? 'المبلغ' : 'Amount'}</th>
            <th>{ar ? 'متاح' : 'Offered'}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {VERIFICATION_KINDS.flatMap((kind) =>
            VERIFICATION_PERIODS.map((period) => {
              const key = `${kind}:${period}`;
              const row = draft[key]!;
              return (
                <tr key={key}>
                  <td>{ar ? KIND_LABELS[kind].ar : KIND_LABELS[kind].en}</td>
                  <td>{ar ? PERIOD_LABELS[period].ar : PERIOD_LABELS[period].en}</td>
                  <td>
                    <input
                      dir="ltr"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: { ...row, price: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: { ...row, active: event.target.checked },
                        }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--primary button--small"
                      disabled={busy === key}
                      onClick={() => void save(kind, period)}
                    >
                      {ar ? 'حفظ' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
