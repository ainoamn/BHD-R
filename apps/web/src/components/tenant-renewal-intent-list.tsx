'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field } from '@bhd-r/ui';
import { SoftPortalLink as Link } from '@/components/soft-portal-link';
import { ModalPortal } from '@/components/modal-portal';
import { TenantRequestLauncher } from '@/components/tenant-request-form';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';
import {
  buildRenewalIntentItems,
  tenancyLandlordName,
  tenancyUnitLabel,
  type MyTenancy,
  type TenancyRenewalIntent,
} from '@/lib/tenancy-shared';

function muscatTodayClient(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

function formatDay(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
      dateStyle: 'medium',
      timeZone: 'Asia/Muscat',
    }).format(new Date(`${iso.slice(0, 10)}T12:00:00+04:00`));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Tenant renewal choices: accept the system term (owner settings), or change dates
 * (auto-approve inside the owner range, otherwise owner approval).
 */
export function TenantRenewalIntentList({
  data,
  locale,
  forceShow = false,
}: {
  data: MyTenancy;
  locale: 'ar' | 'en';
  /** When true (e.g. ?focus=renewal), keep the panel open even if empty for a moment. */
  forceShow?: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('renewal');
  const panelRef = useRef<HTMLElement | null>(null);
  const items = useMemo(
    () => buildRenewalIntentItems(data, muscatTodayClient()),
    [data],
  );
  const [changeItem, setChangeItem] = useState<TenancyRenewalIntent | null>(null);
  const [proposedEndsOn, setProposedEndsOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!forceShow && !highlightId) return;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [forceShow, highlightId, items.length]);

  if (!items.length && !forceShow) return null;

  const requestLeases = items
    .filter((item) => item.phase === 'awaiting_offer')
    .map((item) => {
      const lease = data.leases.find((row) => row.id === item.leaseId);
      return {
        id: item.leaseId,
        label: tenancyUnitLabel(item, ar),
        currency: lease?.currency ?? 'OMR',
        cheques: [],
        maintenanceBlocked: false,
        arrearsMinor: '0',
        arrears: [],
        fromStay: false,
      };
    });

  async function submitChangeDates() {
    if (!changeItem?.renewalContractId || !proposedEndsOn) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await browserNextMutation<{
        status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
        endsOn: string;
      }>(`/api/tenant/contracts/${encodeURIComponent(changeItem.renewalContractId)}/renewal-term`, {
        method: 'POST',
        body: JSON.stringify({ endsOn: proposedEndsOn }),
      });
      setChangeItem(null);
      if (result.status === 'auto_approved') {
        setNotice(
          ar
            ? `تم اعتماد المدة تلقائياً حسب ضبط المالك. نهاية التجديد: ${result.endsOn}`
            : `Term auto-approved within the landlord’s range. Renewal ends: ${result.endsOn}`,
        );
      } else {
        setNotice(
          ar
            ? `أُرسل طلب تغيير التاريخ إلى ${result.endsOn} للمالك للموافقة.`
            : `Date change to ${result.endsOn} was sent to the landlord for approval.`,
        );
      }
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      ref={panelRef}
      id="renewals"
      className="tenant-home__panel tenant-home__panel--renewals has-items"
      aria-label={ar ? 'قائمة التجديد' : 'Renewal list'}
    >
      <div className="tenant-section__head">
        <div className="tenant-section__titles">
          <h2>{ar ? 'قائمة التجديد' : 'Renewal list'}</h2>
          <p>
            {ar
              ? 'اختر رغبتك: التجديد بالمدة التي حددها النظام حسب ضبط المالك، أو تغيير التواريخ.'
              : 'Choose: renew with the system term from the landlord’s settings, or change the dates.'}
          </p>
        </div>
        <span className="tenant-home__count">{items.length}</span>
      </div>

      {notice ? (
        <div className="notice notice--info" role="status" style={{ marginBottom: '0.75rem' }}>
          {notice}
        </div>
      ) : null}

      {!items.length ? (
        <p className="tenant-notice" role="status">
          {ar
            ? 'لا توجد تجديدات بانتظار قرارك الآن.'
            : 'No renewals awaiting your decision right now.'}
        </p>
      ) : (
        <ul className="tenant-preview-list">
          {items.map((item) => {
            const highlighted = highlightId && item.renewalContractId === highlightId;
            return (
              <li
                key={item.key}
                className={`tenant-preview-row tenant-preview-row--contract-renewal${
                  highlighted ? ' is-highlighted' : ''
                }`}
              >
                <div className="tenant-preview-row__main">
                  <span className="tenant-preview-row__eyebrow">
                    {ar ? 'عقد تجديد' : 'Renewal'}
                  </span>
                  <div className="tenant-preview-row__headline">
                    <strong className="tenant-preview-row__title">
                      {tenancyUnitLabel(item, ar)}
                    </strong>
                  </div>
                  <span className="tenant-preview-row__summary">
                    {[
                      item.reference,
                      tenancyLandlordName(item.landlord, ar),
                      ar
                        ? `ينتهي الإيجار ${formatDay(item.leaseEndsOn, true)}`
                        : `Lease ends ${formatDay(item.leaseEndsOn, false)}`,
                      item.systemEndsOn
                        ? ar
                          ? `مدة النظام حتى ${formatDay(item.systemEndsOn, true)}`
                          : `System term until ${formatDay(item.systemEndsOn, false)}`
                        : ar
                          ? 'بانتظار ملحق التجديد'
                          : 'Awaiting renewal addendum',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="tenant-preview-row__side" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                  {item.phase === 'open_renewal' && item.renewalContractId ? (
                    <>
                      <Link
                        href={`/tenant/contracts/${item.renewalContractId}`}
                        className="button button--primary button--sm"
                      >
                        {ar ? 'أرغب بالتجديد' : 'I want to renew'}
                      </Link>
                      <button
                        type="button"
                        className="button button--secondary button--sm"
                        onClick={() => {
                          setChangeItem(item);
                          setProposedEndsOn(item.systemEndsOn ?? '');
                          setError(null);
                        }}
                      >
                        {ar ? 'تغير التواريخ' : 'Change dates'}
                      </button>
                    </>
                  ) : item.phase === 'renewed_pending' ? (
                    <>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        {ar
                          ? `تم اعتماد التجديد حتى ${formatDay(item.systemEndsOn, true)}`
                          : `Renewal already accepted until ${formatDay(item.systemEndsOn, false)}`}
                      </span>
                      {item.renewalContractId ? (
                        <Link
                          href={`/tenant/contracts/${item.renewalContractId}?view=full`}
                          className="button button--quiet button--sm"
                        >
                          {ar ? 'عرض الملحق' : 'View addendum'}
                        </Link>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        {ar
                          ? 'سيصل ملحق التجديد حسب ضبط المالك، أو أرسل طلباً.'
                          : 'The addendum follows landlord settings, or send a request.'}
                      </span>
                      {requestLeases.some((row) => row.id === item.leaseId) ? (
                        <TenantRequestLauncher
                          locale={locale}
                          leases={requestLeases}
                          leaseId={item.leaseId}
                          type="lease_renew"
                          label={ar ? 'طلب تجديد' : 'Request renewal'}
                          className="button button--quiet button--sm"
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {changeItem ? (
        <ModalPortal>
          <div className="ops-modal" onClick={() => !busy && setChangeItem(null)}>
            <div
              className="ops-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="renewal-change-dates-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="ops-modal__head">
                <h2 id="renewal-change-dates-title">
                  {ar ? 'تغير تواريخ التجديد' : 'Change renewal dates'}
                </h2>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => setChangeItem(null)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </header>
              <p className="muted">
                {ar
                  ? 'المدة الافتراضية من ضبط المالك. إن كانت مدتك ضمن نفس النطاق تُعتمد تلقائياً؛ وإن كانت أقصر تُرسل لموافقة المالك.'
                  : 'The default term comes from the landlord’s settings. Within that range it is auto-approved; a shorter term needs landlord approval.'}
              </p>
              {changeItem.systemEndsOn ? (
                <p>
                  {ar ? 'تاريخ النظام الحالي: ' : 'Current system end: '}
                  <strong dir="ltr">{changeItem.systemEndsOn}</strong>
                </p>
              ) : null}
              <Field
                id="tenant-renewal-change-ends"
                type="date"
                label={ar ? 'تاريخ النهاية المقترح' : 'Proposed end date'}
                value={proposedEndsOn}
                onChange={(event) => setProposedEndsOn(event.target.value)}
              />
              {error ? (
                <div className="notice notice--danger" role="alert" style={{ marginTop: '0.75rem' }}>
                  {error}
                </div>
              ) : null}
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  disabled={busy || !proposedEndsOn}
                  onClick={() => void submitChangeDates()}
                >
                  {busy ? (ar ? 'جاري الإرسال…' : 'Sending…') : ar ? 'إرسال' : 'Send'}
                </Button>
                <Button
                  type="button"
                  className="button--secondary"
                  disabled={busy}
                  onClick={() => setChangeItem(null)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  );
}
