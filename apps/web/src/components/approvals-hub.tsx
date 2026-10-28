'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { browserMutation } from '@/lib/api';
import {
  approvalStatusLabel,
  approvalTypeLabel,
  decidableInHub,
  signatureMethodLabel,
  signerRoleLabel,
  type ApprovalRequestRow,
  type ApprovalsHub as HubData,
  type SignatureRegisterEntry,
} from '@/lib/approvals-hub-shared';
import { formatMoney } from '@/lib/format';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  pendingApprovalAmount,
  pendingApprovalHref,
  pendingApprovalTitle,
  type PendingApprovalItem,
} from '@/lib/pending-approvals-shared';
import type { PortalRole } from '@/lib/types';

type Tab = 'pending' | 'requests' | 'signatures';

const POLL_MS = 60_000;

const GROUPS: { key: string; ar: string; en: string; kinds: PendingApprovalItem['kind'][] }[] = [
  {
    key: 'bookings',
    ar: 'الحجوزات ومستنداتها',
    en: 'Bookings and their documents',
    kinds: ['lease_reservation', 'stay_booking', 'guest_review'],
  },
  {
    key: 'contracts',
    ar: 'العقود والوحدات',
    en: 'Contracts and units',
    kinds: ['contract', 'renewal_term', 'sale_decision'],
  },
  {
    key: 'money',
    ar: 'التأمينات والتحويلات والمهام المالية',
    en: 'Deposits, transfers, and money tasks',
    kinds: ['deposit_refund', 'refund_transfer', 'deposit_claim', 'deposit_complaint'],
  },
  { key: 'legal', ar: 'القضايا', en: 'Legal cases', kinds: ['legal_message'] },
];

function formatDate(value: string | null, ar: boolean, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function placeName(
  row: { propertyNameAr: string | null; propertyNameEn: string | null; unitCode: string | null },
  ar: boolean,
): string | null {
  const property = ar ? row.propertyNameAr : row.propertyNameEn || row.propertyNameAr;
  if (!property) return row.unitCode;
  return row.unitCode ? `${property} — ${row.unitCode}` : property;
}

function PlaceLabel({
  row,
  ar,
}: {
  row: { propertyNameAr: string | null; propertyNameEn: string | null; unitCode: string | null };
  ar: boolean;
}) {
  const property = ar ? row.propertyNameAr : row.propertyNameEn || row.propertyNameAr;
  const unit = row.unitCode ? <bdi className="approvals-hub__code">{row.unitCode}</bdi> : null;
  if (!property) return unit ?? <>—</>;
  return unit ? (
    <>
      {property} — {unit}
    </>
  ) : (
    <>{property}</>
  );
}

function contractHref(portal: PortalRole, contractId: string, propertyId: string | null): string {
  if (portal === 'owner') return `/owner/contracts/${encodeURIComponent(contractId)}`;
  return propertyId
    ? `/${portal}/properties/${encodeURIComponent(propertyId)}?section=contracts&focus=${encodeURIComponent(contractId)}`
    : `/${portal}/contracts`;
}

function requestHref(portal: PortalRole, row: ApprovalRequestRow): string {
  if (row.resourceType === 'contract') return contractHref(portal, row.resourceId, row.propertyId);
  if (row.resourceType === 'expense') return `/${portal}/expenses`;
  if (row.resourceType === 'maintenance_work_order') return `/${portal}/work-orders`;
  return `/${portal}/approvals`;
}

function signatureHref(portal: PortalRole, row: SignatureRegisterEntry): string {
  if (row.kind === 'contract') return contractHref(portal, row.parentId, row.propertyId);
  if (portal === 'owner') return `/owner/bookings/${encodeURIComponent(row.parentId)}`;
  return row.propertyId
    ? `/${portal}/properties/${encodeURIComponent(row.propertyId)}?section=bookings&focus=${encodeURIComponent(row.parentId)}`
    : `/${portal}/bookings`;
}

/**
 * The approvals hub: what awaits the viewer's decision, approval requests with their
 * decision buttons, and the register of online signatures with their serials.
 */
export function ApprovalsHub({
  portal,
  locale,
  active,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<HubData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/approvals', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as HubData);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onChanged = () => void load();
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      if (!detail || detail.section === 'approvals') void load();
    };
    window.addEventListener(PENDING_APPROVALS_CHANGED_EVENT, onChanged);
    window.addEventListener('bhd-r-ops-refresh', onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PENDING_APPROVALS_CHANGED_EVENT, onChanged);
      window.removeEventListener('bhd-r-ops-refresh', onRefresh);
    };
  }, [active, load]);

  async function decide(row: ApprovalRequestRow, decision: 'approved' | 'rejected') {
    setBusy(row.id);
    setError(null);
    try {
      const note = notes[row.id]?.trim();
      await browserMutation(`/v1/operations/approvals/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(note ? { decision, note } : { decision }),
      });
      setNotes((current) => ({ ...current, [row.id]: '' }));
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      await load();
    } catch {
      setError(
        ar
          ? 'تعذّر حفظ القرار. ربما بُتّ في الطلب من مكان آخر — حدّث الصفحة وحاول مجدداً.'
          : 'Could not save the decision. It may have been decided elsewhere — refresh and retry.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <section className="approvals-hub" aria-busy={!failed}>
        <p className="approvals-hub__empty" role={failed ? 'alert' : 'status'}>
          {failed
            ? ar
              ? 'تعذّر تحميل مركز الاعتمادات. حاول مجدداً بعد قليل.'
              : 'Could not load the approvals hub. Try again shortly.'
            : ar
              ? 'جاري التحميل…'
              : 'Loading…'}
        </p>
        {failed ? (
          <button type="button" className="button" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        ) : null}
      </section>
    );
  }

  const pendingRequests = data.requests.filter(
    (row) => row.status === 'pending' || row.status === 'on_hold',
  ).length;
  const needle = query.trim().toLowerCase();
  const signatures = data.signatures.filter(
    (row) =>
      !needle ||
      [row.serial, row.reference, row.signer, row.propertyNameAr, row.propertyNameEn, row.unitCode]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
  );
  const tabs: { key: Tab; ar: string; en: string; count: number }[] = [
    { key: 'pending', ar: 'بانتظار قرارك', en: 'Awaiting you', count: data.pending.total },
    { key: 'requests', ar: 'طلبات الاعتماد', en: 'Approval requests', count: pendingRequests },
    ...(data.canReadSignatures
      ? [
          {
            key: 'signatures' as const,
            ar: 'العقود الموقّعة إلكترونياً',
            en: 'E-signed contracts',
            count: data.signatures.length,
          },
        ]
      : []),
  ];

  return (
    <section className="approvals-hub" aria-label={ar ? 'مركز الاعتمادات' : 'Approvals hub'}>
      <div className="approvals-hub__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'approvals-hub__tab is-active' : 'approvals-hub__tab'}
            onClick={() => setTab(item.key)}
          >
            <span>{ar ? item.ar : item.en}</span>
            <b>{item.count}</b>
          </button>
        ))}
      </div>

      {error ? (
        <p className="approvals-hub__error" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'pending' ? (
        data.pending.items.length ? (
          GROUPS.map((group) => {
            const items = data.pending.items.filter((item) => group.kinds.includes(item.kind));
            if (!items.length) return null;
            return (
              <div key={group.key} className="approvals-hub__group">
                <h2>
                  {ar ? group.ar : group.en} <span>{items.length}</span>
                </h2>
                <ul className="approvals-hub__list">
                  {items.map((item) => {
                    const amount = pendingApprovalAmount(item, locale);
                    const place = placeName(item, ar);
                    return (
                      <li key={`${item.kind}:${item.id}`} className="approvals-hub__item">
                        <div className="approvals-hub__main">
                          <strong>{pendingApprovalTitle(item, ar)}</strong>
                          <span className="approvals-hub__meta">
                            {[item.reference, place, item.party].filter(Boolean).join(' · ')}
                          </span>
                          {amount ? <span className="approvals-hub__amount">{amount}</span> : null}
                        </div>
                        <div className="approvals-hub__side">
                          <time dateTime={item.requestedAt}>
                            {formatDate(item.requestedAt, ar)}
                          </time>
                          <Link
                            className="button button--primary button--small"
                            href={pendingApprovalHref(portal, item)}
                          >
                            {item.kind === 'deposit_claim'
                              ? ar
                                ? 'افتح في الحسابات وتحقق'
                                : 'Open in Accounting and verify'
                              : item.kind === 'refund_transfer'
                                ? ar
                                  ? 'افتح للتحويل'
                                  : 'Open to transfer'
                                : ar
                                  ? 'افتح واتخذ القرار'
                                  : 'Open and decide'}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        ) : (
          <p className="approvals-hub__empty">
            {ar
              ? 'لا يوجد شيء بانتظار قرارك الآن. ستظهر هنا الحجوزات ومستنداتها، والعقود الجاهزة للتوقيع، وطلبات التأمين فور وصولها.'
              : 'Nothing awaits your decision right now. Bookings, documents, contracts to sign and deposit requests appear here as they arrive.'}
          </p>
        )
      ) : null}

      {tab === 'requests' ? (
        data.requests.length ? (
          <ul className="approvals-hub__list">
            {data.requests.map((row) => {
              const place = placeName(row, ar);
              const decidable = data.canDecide && decidableInHub(row);
              const contractPending =
                row.resourceType === 'contract' &&
                (row.status === 'pending' || row.status === 'on_hold');
              return (
                <li key={row.id} className="approvals-hub__item approvals-hub__item--request">
                  <div className="approvals-hub__main">
                    <span className="approvals-hub__chips">
                      <span className="approvals-hub__chip">{approvalTypeLabel(row, ar)}</span>
                      <span
                        className={`approvals-hub__status approvals-hub__status--${row.status}`}
                      >
                        {approvalStatusLabel(row.status, ar)}
                      </span>
                    </span>
                    <strong>{row.subject}</strong>
                    <span className="approvals-hub__meta">
                      {[row.reference, row.targetReference, place].filter(Boolean).join(' · ')}
                    </span>
                    {row.amountMinor && row.currency && /^\d+$/.test(row.amountMinor) ? (
                      <span className="approvals-hub__amount">
                        {formatMoney(row.amountMinor, row.currency, locale)}
                      </span>
                    ) : null}
                    <span className="approvals-hub__meta">
                      {ar ? 'طلبه' : 'Requested by'} {row.requestedBy || '—'} ·{' '}
                      {formatDate(row.createdAt, ar)}
                      {row.decidedAt
                        ? ` · ${ar ? 'بتّ فيه' : 'Decided by'} ${row.decidedBy || '—'} · ${formatDate(row.decidedAt, ar)}`
                        : ''}
                    </span>
                    {row.decisionNote ? (
                      <span className="approvals-hub__note">{row.decisionNote}</span>
                    ) : null}
                  </div>
                  <div className="approvals-hub__side">
                    {decidable ? (
                      <div className="approvals-hub__decide">
                        <input
                          type="text"
                          maxLength={500}
                          value={notes[row.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                          placeholder={ar ? 'ملاحظة القرار (اختياري)' : 'Decision note (optional)'}
                          aria-label={ar ? 'ملاحظة القرار' : 'Decision note'}
                        />
                        <button
                          type="button"
                          className="button button--primary button--small"
                          disabled={busy === row.id}
                          onClick={() => void decide(row, 'approved')}
                        >
                          {ar ? 'اعتماد' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          disabled={busy === row.id}
                          onClick={() => void decide(row, 'rejected')}
                        >
                          {ar ? 'رفض' : 'Reject'}
                        </button>
                      </div>
                    ) : null}
                    <Link
                      className={
                        contractPending
                          ? 'button button--primary button--small'
                          : 'button button--secondary button--small'
                      }
                      href={requestHref(portal, row)}
                    >
                      {contractPending
                        ? ar
                          ? 'افتح العقد للتوقيع'
                          : 'Open contract to sign'
                        : ar
                          ? 'فتح'
                          : 'Open'}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="approvals-hub__empty">
            {ar
              ? 'لا توجد طلبات اعتماد. تُنشأ تلقائياً عندما يجهّز أحد أعضاء فريقك عقداً لا يملك صلاحية توقيعه، أو يسجّل مصروفاً أو أمر صيانة يحتاج موافقتك.'
              : 'No approval requests. They are raised when a team member prepares a contract they may not sign, or records an expense or work order that needs your approval.'}
          </p>
        )
      ) : null}

      {tab === 'signatures' ? (
        <div className="approvals-hub__register">
          <p className="approvals-hub__intro">
            {ar
              ? 'كل توقيع إلكتروني على عقد أو حجز يحصل على رقم متسلسل (ES-السنة-الرقم) يُطبع على العقد. يمكن لأي طرف التحقق من العقد عبر رابط التحقق أو رمز QR المطبوع عليه.'
              : 'Every e-signature on a contract or booking gets a serial (ES-year-number) printed on the contract. Anyone can check the contract through its verification link or printed QR code.'}
          </p>
          <input
            type="search"
            className="approvals-hub__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              ar ? 'ابحث بالرقم المتسلسل أو المرجع أو الاسم' : 'Search by serial, reference or name'
            }
            aria-label={ar ? 'بحث في التوقيعات' : 'Search signatures'}
          />
          {signatures.length ? (
            <div className="approvals-hub__table-wrap">
              <table className="approvals-hub__table">
                <thead>
                  <tr>
                    <th>{ar ? 'الرقم المتسلسل' : 'Serial'}</th>
                    <th>{ar ? 'المستند' : 'Document'}</th>
                    <th>{ar ? 'العقار' : 'Property'}</th>
                    <th>{ar ? 'الموقّع' : 'Signer'}</th>
                    <th>{ar ? 'طريقة التوقيع' : 'Method'}</th>
                    <th>{ar ? 'التاريخ' : 'Signed'}</th>
                    <th>
                      <span className="sr-only">{ar ? 'إجراءات' : 'Actions'}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {signatures.map((row) => (
                    <tr key={`${row.kind}:${row.id}`}>
                      <td>
                        <code className="approvals-hub__serial" dir="ltr">
                          {row.serial}
                        </code>
                      </td>
                      <td>
                        <strong>
                          {row.kind === 'reservation'
                            ? row.contractType === 'sale'
                              ? ar
                                ? 'حجز شراء'
                                : 'Purchase booking'
                              : ar
                                ? 'حجز إيجار'
                                : 'Rent booking'
                            : row.contractType === 'sale'
                              ? ar
                                ? 'عقد بيع'
                                : 'Sale contract'
                              : ar
                                ? 'عقد إيجار'
                                : 'Lease contract'}
                        </strong>
                        <bdi className="approvals-hub__meta approvals-hub__code">
                          {row.reference || '—'}
                        </bdi>
                      </td>
                      <td>
                        <PlaceLabel row={row} ar={ar} />
                      </td>
                      <td>
                        {row.signer || '—'}
                        <span className="approvals-hub__meta">
                          {signerRoleLabel(row.signerRole, ar)}
                        </span>
                      </td>
                      <td>{signatureMethodLabel(row.method, ar)}</td>
                      <td>
                        <time dateTime={row.signedAt}>{formatDate(row.signedAt, ar, true)}</time>
                      </td>
                      <td className="approvals-hub__actions">
                        <Link
                          className="button button--secondary button--small"
                          href={signatureHref(portal, row)}
                        >
                          {ar ? 'فتح' : 'Open'}
                        </Link>
                        {row.verifyUrl ? (
                          <a
                            className="button button--secondary button--small"
                            href={row.verifyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {ar ? 'التحقق' : 'Verify'}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="approvals-hub__empty">
              {needle
                ? ar
                  ? 'لا توجد نتائج مطابقة.'
                  : 'No matching signatures.'
                : ar
                  ? 'لا توجد توقيعات إلكترونية بعد.'
                  : 'No e-signatures yet.'}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
