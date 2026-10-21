'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { AccountingFollowTask } from '@/components/accounting/accounting-follow-task';
import { DepositClaimsAdmin } from '@/components/accounting/deposit-claims-admin';
import { DepositReconciliation } from '@/components/accounting/deposit-receipts';
import {
  DepositRefundCell,
  DepositRefundForm,
  type RefundSubmit,
} from '@/components/stays/stay-deposit-refund-admin';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import type { DepositClaimView } from '@/lib/stay-deposit-claims';
import { domainStatusLabel } from '@/lib/ui-labels';

type Row = Record<string, string | null>;
type Viewer = { canPayRefunds: boolean; canDecideRefunds: boolean };
type Filter = 'open' | 'awaiting_refund_transfer' | 'deposit_held' | 'deposit_settled' | 'all';

const ORDER: Record<string, number> = {
  awaiting_refund_transfer: 0,
  awaiting_deposit_refund: 1,
  deposit_held: 2,
  deposit_settled: 3,
};

const TONE: Record<string, string> = {
  awaiting_refund_transfer: 'warn',
  awaiting_deposit_refund: 'warn',
  deposit_held: 'info',
  deposit_settled: 'ready',
};

function totals(rows: Row[], pick: (row: Row) => string | null | undefined) {
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    const value = pick(row);
    if (!value || !/^\d+$/.test(value)) continue;
    const currency = row.currency || 'OMR';
    sums.set(currency, (sums.get(currency) ?? 0n) + BigInt(value));
  }
  return [...sums.entries()];
}

/** Refund and deduction once the host decided; both null while the decision is pending. */
function settlementSplit(row: Row): { refund: string | null; deducted: string | null } {
  const deposit = row.depositMinor;
  if (!deposit || !/^\d+$/.test(deposit)) return { refund: null, deducted: null };
  if (row.refundStatus === 'rejected') return { refund: '0', deducted: deposit };
  const amount = row.refundAmountMinor;
  if (
    (row.refundStatus !== 'approved' && row.refundStatus !== 'executed') ||
    !amount ||
    !/^\d+$/.test(amount)
  ) {
    return { refund: null, deducted: null };
  }
  const kept = BigInt(deposit) - BigInt(amount);
  return { refund: amount, deducted: (kept > 0n ? kept : 0n).toString() };
}

function formatDay(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function pendingRefund(row: Row): string | null {
  return row.status === 'awaiting_refund_transfer'
    ? (row.refundDueMinor ?? row.refundAmountMinor ?? null)
    : null;
}

/**
 * Stay deposits on the accountant page: money held in trust, apart from income, rent,
 * maintenance and salaries. The accountant transfers approved refunds from here; whatever the
 * owner deducted becomes the property's income, with a receipt linked to the refund receipt.
 */
export function DepositLedgerPanel({
  portal,
  locale,
  active,
}: {
  portal: string;
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const searchParams = useSearchParams();
  const focusId = active ? searchParams.get('focus') : null;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [claims, setClaims] = useState<Record<string, DepositClaimView[]>>({});
  const [viewer, setViewer] = useState<Viewer>({ canPayRefunds: false, canDecideRefunds: false });
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** Default to all so settled refunds still show the deposit the guest paid. */
  const [filter, setFilter] = useState<Filter>('all');
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const silentReload = useRef(false);

  useEffect(() => {
    const onLiveChange = () => {
      silentReload.current = true;
      setReloadKey((key) => key + 1);
    };
    window.addEventListener(LIVE_CHANGE_EVENT, onLiveChange);
    return () => window.removeEventListener(LIVE_CHANGE_EVENT, onLiveChange);
  }, []);

  useEffect(() => {
    if (!active && rows !== null) return;
    const controller = new AbortController();
    const silent = silentReload.current;
    silentReload.current = false;
    void (async () => {
      try {
        const response = await fetch('/api/owner/accounting/deposits', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 403 || response.status === 401) {
          setHidden(true);
          return;
        }
        if (!response.ok) throw new Error(`status_${response.status}`);
        const payload = (await response.json()) as {
          rows?: Row[];
          claims?: Record<string, DepositClaimView[]>;
          viewer?: Viewer;
        };
        setRows(payload.rows ?? []);
        setClaims(payload.claims ?? {});
        setViewer(payload.viewer ?? { canPayRefunds: false, canDecideRefunds: false });
        setFailed(false);
      } catch {
        if (!controller.signal.aborted && !silent) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [active, reloadKey]);

  useEffect(() => {
    if (!focusId || !rows?.length) return;
    if (rows.some((row) => row.id === focusId)) setFilter('all');
    const timer = window.setTimeout(() => {
      document
        .getElementById(`deposit-${focusId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusId, rows]);

  const claimOpen = useMemo(() => {
    const ids = new Set<string>();
    for (const [bookingId, list] of Object.entries(claims)) {
      if (list.some((claim) => claim.status === 'open' || claim.status === 'escalated')) {
        ids.add(bookingId);
      }
    }
    return ids;
  }, [claims]);

  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort(
        (a, b) =>
          Number(claimOpen.has(b.id ?? '')) - Number(claimOpen.has(a.id ?? '')) ||
          (ORDER[a.status ?? ''] ?? 9) - (ORDER[b.status ?? ''] ?? 9) ||
          (b.settledOn ?? b.receivedOn ?? '').localeCompare(a.settledOn ?? a.receivedOn ?? ''),
      ),
    [rows, claimOpen],
  );

  const visible = useMemo(
    () =>
      sorted.filter((row) => {
        if (filter === 'all') return true;
        if (filter === 'open')
          return row.status !== 'deposit_settled' || claimOpen.has(row.id ?? '');
        if (filter === 'deposit_held')
          return row.status === 'deposit_held' || row.status === 'awaiting_deposit_refund';
        return row.status === filter;
      }),
    [sorted, filter, claimOpen],
  );

  if (hidden) return null;

  const all = rows ?? [];
  const held = all.filter((row) => row.status !== 'deposit_settled');
  const awaiting = all.filter((row) => row.status === 'awaiting_refund_transfer');
  const cards: Array<{ label: string; hint: string; values: Array<[string, bigint]> }> = [
    {
      label: ar ? `أمانات محتجزة (${held.length})` : `Held in trust (${held.length})`,
      hint: ar ? 'ليست دخلاً' : 'Not income',
      values: totals(held, (row) => row.depositMinor),
    },
    {
      label: ar ? `بانتظار تحويلك (${awaiting.length})` : `To transfer (${awaiting.length})`,
      hint: ar ? 'استرداد معتمد للضيوف' : 'Approved guest refunds',
      values: totals(awaiting, pendingRefund),
    },
    {
      label: ar ? 'مُسترد للضيوف' : 'Refunded to guests',
      hint: ar ? 'من أمانات التأمين' : 'Out of the deposits',
      values: totals(all, (row) => row.refundedMinor),
    },
    {
      label: ar ? 'دخل من خصومات التأمين' : 'Income kept from deposits',
      hint: ar ? 'يدخل في إيراد العقار' : "Part of the property's income",
      values: totals(all, (row) => row.retainedMinor),
    },
  ];
  const filters: Array<[Filter, string]> = [
    ['all', ar ? 'الكل' : 'All'],
    ['open', ar ? 'المفتوحة' : 'Open'],
    ['awaiting_refund_transfer', ar ? 'بانتظار التحويل' : 'To transfer'],
    ['deposit_held', ar ? 'محتجزة' : 'Held'],
    ['deposit_settled', ar ? 'مُسوّاة' : 'Settled'],
  ];

  async function submitPayout(row: Row, value: RefundSubmit) {
    const bookingId = row.id ?? '';
    const propertyId = row.propertyId ?? '';
    if (!bookingId || !propertyId || value.action !== 'refund_payout') return;
    setBusyId(bookingId);
    setNotice(null);
    try {
      await browserNextMutation(`/api/owner/properties/${encodeURIComponent(propertyId)}/records`, {
        method: 'POST',
        body: JSON.stringify({ ...value, bookingId }),
      });
      setPayoutId(null);
      const kept =
        /^\d+$/.test(row.depositMinor ?? '') && /^\d+$/.test(row.refundAmountMinor ?? '')
          ? BigInt(row.depositMinor!) - BigInt(row.refundAmountMinor!)
          : 0n;
      const currency = row.currency || 'OMR';
      setNotice({
        tone: 'success',
        text: ar
          ? `تم تسجيل تحويل تأمين الحجز ${row.reference}${
              kept > 0n
                ? `، وسُجّل ${formatMoney(kept.toString(), currency, locale)} دخلاً للعقار بإيصال مرتبط بإيصال الاسترداد`
                : ''
            }. أُغلق الحجز ويرى الضيف أن المبلغ حُوّل.`
          : `Deposit transfer recorded for ${row.reference}${
              kept > 0n
                ? `; ${formatMoney(kept.toString(), currency, locale)} was booked as property income with a linked receipt`
                : ''
            }. The booking is closed.`,
      });
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      setReloadKey((key) => key + 1);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      setNotice({
        tone: 'error',
        text:
          code === 'forbidden'
            ? ar
              ? 'تحويل التأمين لمن يملك صلاحية صرف المبالغ المستردة.'
              : 'Only staff allowed to pay refunds can record the transfer.'
            : code === 'refund_not_approved'
              ? ar
                ? 'هذا الاسترداد لم يعد بانتظار التحويل؛ حُدّثت القائمة.'
                : 'This refund is no longer awaiting transfer; the list was refreshed.'
              : ar
                ? 'تعذّر تسجيل التحويل. تحقّق من البيانات وحاول مجدداً.'
                : 'Could not record the transfer. Check the details and try again.',
      });
      if (code === 'refund_not_approved') setReloadKey((key) => key + 1);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      className="deposit-ledger pmh-card"
      id="deposits"
      aria-labelledby="deposit-ledger-title"
    >
      <header className="deposit-ledger__head">
        <div>
          <h2 id="deposit-ledger-title">{ar ? 'أمانات التأمين' : 'Deposits held in trust'}</h2>
          <p className="muted">
            {ar
              ? 'تأمينات الإقامة وعربون حجوزات الموقع أمانة لدى العقار، معزولة عن الإيرادات. لا يدخل من تأمين الإقامة في الدخل إلا ما يُخصم عند الاسترداد.'
              : 'Stay deposits and website booking deposits are held in trust, apart from income. Only what is deducted from a stay deposit at refund becomes income.'}
          </p>
        </div>
      </header>

      <div className="deposit-ledger__cards">
        {cards.map((card) => (
          <div key={card.label} className="deposit-ledger__card">
            <span className="deposit-ledger__label">{card.label}</span>
            <strong dir="ltr">
              {card.values.length
                ? card.values
                    .map(([currency, value]) => formatMoney(value.toString(), currency, locale))
                    .join(' · ')
                : formatMoney('0', 'OMR', locale)}
            </strong>
            <small className="muted">{card.hint}</small>
          </div>
        ))}
      </div>

      <div className="deposit-ledger__filters" role="group" aria-label={ar ? 'تصفية' : 'Filter'}>
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`deposit-ledger__chip${filter === key ? ' is-active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? (
        <p
          className={`notice notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

      {failed ? (
        <p className="notice notice--error" role="alert">
          {ar ? 'تعذّر تحميل أمانات التأمين.' : 'Could not load the deposits.'}{' '}
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : rows === null ? (
        <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : !visible.length ? (
        <p className="muted deposit-ledger__empty">
          {all.length
            ? ar
              ? 'لا توجد مبالغ تأمين في هذا التصنيف.'
              : 'No deposits in this view.'
            : ar
              ? 'لا توجد مبالغ تأمين أو عربون مسجّلة بعد. تظهر هنا تأمينات الإقامة المؤكدة والمستلمة وعربون حجوزات الموقع.'
              : 'No stay deposits or booking deposits yet. Confirmed stay deposits and website booking deposits appear here.'}
        </p>
      ) : (
        <ul className="deposit-ledger__list">
          {visible.map((row) => {
            const id = row.id ?? '';
            const propertyId = row.propertyId ?? '';
            const status = row.status ?? '';
            const property = ar ? row.propertyName : row.propertyNameEn;
            const propertyHref = `/${portal}/properties/${encodeURIComponent(propertyId)}`;
            const currency = row.currency || 'OMR';
            const split = settlementSplit(row);
            const hasClaim = claimOpen.has(id);
            const isOpen = expanded[id] ?? (hasClaim || focusId === id);
            const detailsId = `deposit-details-${id}`;
            const money = (value: string | null) =>
              value === null ? '—' : formatMoney(value, currency, locale);
            return (
              <li
                key={id}
                id={`deposit-${id}`}
                className={`deposit-ledger__item${focusId === id ? ' is-focus' : ''}${
                  isOpen ? ' is-open' : ''
                }`}
              >
                <div className="deposit-ledger__row">
                  <div className="deposit-ledger__who">
                    <strong className="deposit-ledger__ref" dir="ltr">
                      {row.reference}
                    </strong>
                    <span className="deposit-ledger__place">
                      <bdi>{[property, row.unitCode].filter(Boolean).join(' · ') || '—'}</bdi>
                    </span>
                  </div>
                  <dl className="deposit-ledger__facts">
                    <div>
                      <dt>{ar ? 'تاريخ الطلب' : 'Requested'}</dt>
                      <dd>{row.refundRequestedAt ? formatDay(row.refundRequestedAt, ar) : '—'}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'مبلغ التأمين' : 'Deposit'}</dt>
                      <dd dir="ltr">{money(row.depositMinor ?? null)}</dd>
                    </div>
                    <div>
                      <dt>{ar ? 'الخصم' : 'Deducted'}</dt>
                      <dd
                        dir="ltr"
                        className={
                          split.deducted && split.deducted !== '0' ? 'is-deducted' : undefined
                        }
                      >
                        {money(split.deducted)}
                      </dd>
                    </div>
                    <div>
                      <dt>{ar ? 'المسترد' : 'Refund'}</dt>
                      <dd dir="ltr" className="is-refund">
                        {money(split.refund)}
                      </dd>
                    </div>
                  </dl>
                  <div className="deposit-ledger__state">
                    <span className={`pmh-badge pmh-badge--${TONE[status] ?? 'muted'}`}>
                      {domainStatusLabel(status, locale)}
                    </span>
                    {row.kind === 'reservation_deposit' ? (
                      <span className="pmh-badge pmh-badge--info">
                        {ar ? 'عربون حجز' : 'Booking deposit'}
                      </span>
                    ) : null}
                    {row.kind === 'stay_payment_refund' ? (
                      <span className="pmh-badge pmh-badge--warn">
                        {ar ? 'إرجاع مبلغ حجز ملغى' : 'Cancelled booking refund'}
                      </span>
                    ) : null}
                    {hasClaim ? (
                      <span className="pmh-badge pmh-badge--danger">
                        {ar ? 'طلب من الضيف' : 'Guest request'}
                      </span>
                    ) : null}
                  </div>
                  <div className="deposit-ledger__row-actions">
                    {row.kind !== 'reservation_deposit' &&
                    status === 'awaiting_refund_transfer' &&
                    viewer.canPayRefunds ? (
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={busyId === id}
                        aria-expanded={payoutId === id}
                        onClick={() => {
                          setNotice(null);
                          setPayoutId(payoutId === id ? null : id);
                        }}
                      >
                        {row.kind === 'stay_payment_refund'
                          ? ar
                            ? 'تحويل مبلغ الحجز'
                            : 'Transfer booking payment'
                          : ar
                            ? 'تحويل التأمين'
                            : 'Transfer deposit'}
                      </button>
                    ) : null}
                    <AccountingFollowTask
                      locale={locale}
                      kind="deposit"
                      sourceId={id}
                      title={`${row.reference ?? id} · ${property ?? ''}`.trim()}
                      detail={[row.unitCode, row.guestName].filter(Boolean).join(' · ')}
                      dueOn={row.refundRequestedAt?.slice(0, 10)}
                    />
                    <button
                      type="button"
                      className="button button--secondary deposit-ledger__toggle"
                      aria-expanded={isOpen}
                      aria-controls={detailsId}
                      onClick={() => setExpanded((map) => ({ ...map, [id]: !isOpen }))}
                    >
                      {isOpen
                        ? ar
                          ? 'إخفاء التفاصيل'
                          : 'Hide details'
                        : ar
                          ? 'التفاصيل'
                          : 'Details'}
                    </button>
                  </div>
                </div>
                {row.kind !== 'reservation_deposit' && payoutId === id ? (
                  <DepositRefundForm
                    mode="payout"
                    row={{ ...row, kind: 'deposit_refund' }}
                    locale={locale}
                    busy={busyId === id}
                    defaultAmount=""
                    onSubmit={(value) => void submitPayout(row, value)}
                    onCancel={() => setPayoutId(null)}
                  />
                ) : null}
                {isOpen ? (
                  <div className="deposit-ledger__details" id={detailsId}>
                    {row.party ? (
                      <p className="deposit-ledger__guest">
                        {ar ? 'الضيف: ' : 'Guest: '}
                        <bdi>{row.party}</bdi>
                      </p>
                    ) : null}
                    {row.kind === 'reservation_deposit' ? (
                      <p className="muted">
                        {row.refundDecisionNote ||
                          (ar
                            ? 'عربون مدفوع من موقع الحجز (إيجار/بيع).'
                            : 'Deposit paid on the website booking (rent/sale).')}
                      </p>
                    ) : (
                      <div className="deposit-ledger__item-body">
                        <section className="deposit-ledger__panel">
                          <h3 className="deposit-ledger__panel-title">
                            {ar ? 'التسوية' : 'Settlement'}
                          </h3>
                          <DepositReconciliation
                            row={row}
                            locale={locale}
                            hideNote={Boolean(row.refundStatus)}
                            onError={(message) => setNotice({ tone: 'error', text: message })}
                          />
                        </section>
                        {row.refundStatus ? (
                          <section className="deposit-ledger__panel deposit-ledger__panel--refund">
                            <h3 className="deposit-ledger__panel-title">
                              {ar ? 'تفاصيل الاسترداد' : 'Refund details'}
                            </h3>
                            <DepositRefundCell
                              row={{ ...row, kind: 'deposit_refund' }}
                              locale={locale}
                              receiptHref={
                                row.refundReceipt && propertyId
                                  ? `/api/owner/properties/${encodeURIComponent(propertyId)}/records/refund-receipt/${id}`
                                  : null
                              }
                            />
                          </section>
                        ) : null}
                        <DepositClaimsAdmin
                          claims={claims[id] ?? []}
                          currency={row.currency || 'OMR'}
                          canDecide={viewer.canDecideRefunds}
                          locale={locale}
                          onDone={(next, reload) => {
                            setNotice(next);
                            if (!reload) return;
                            window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
                            setReloadKey((key) => key + 1);
                          }}
                        />
                      </div>
                    )}
                    <div className="deposit-ledger__actions">
                      {row.kind !== 'reservation_deposit' &&
                      status === 'awaiting_deposit_refund' &&
                      viewer.canDecideRefunds ? (
                        <Link
                          className="button button--quiet"
                          href={`${propertyHref}?section=bookings&focus=${encodeURIComponent(id)}`}
                          prefetch={false}
                        >
                          {ar ? 'قرار الاسترداد (المالك) ←' : 'Refund decision (owner) →'}
                        </Link>
                      ) : null}
                      {propertyId ? (
                        <Link
                          className="button button--quiet"
                          href={`${propertyHref}?section=accounting&focus=${encodeURIComponent(id)}`}
                          prefetch={false}
                        >
                          {ar ? 'حسابات العقار ←' : 'Property accounting →'}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
