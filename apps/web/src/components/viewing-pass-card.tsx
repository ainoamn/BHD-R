'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { ViewingGuestDecision, ViewingGuestPass } from '@/lib/viewing-requests-shared';

type PassPayload = ViewingGuestPass & { qrSvg: string | null };

function stamp(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function toLocalInputValue(iso: string | null): string {
  const base = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(base.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
}

function errorMessage(code: string, ar: boolean): string {
  switch (code) {
    case 'viewing_not_arrived':
      return ar
        ? 'بعد مسح الباركود أو إدخال بياناتك من الحارس يمكنك اختيار الحجز أو الرفض.'
        : 'After the guard scans your pass or enters your details you can choose to book or decline.';
    case 'viewing_already_arrived':
      return ar
        ? 'تم تسجيل وصولك — لا يمكن تغيير الموعد أو الإلغاء الآن.'
        : 'Your arrival is already recorded — you cannot change or cancel now.';
    case 'viewing_closed':
      return ar ? 'هذا الموعد مغلق ولم يعد قابلاً للتعديل.' : 'This appointment is closed.';
    case 'viewing_decision_locked':
      return ar ? 'تم تسجيل قرارك مسبقاً.' : 'Your decision was already recorded.';
    case 'viewing_schedule_invalid':
      return ar ? 'اختر موعداً صالحاً في المستقبل.' : 'Pick a valid future date and time.';
    default:
      return ar ? 'تعذّر إكمال الطلب. حاول مرة أخرى.' : 'Could not complete the request. Try again.';
  }
}

function statusLabel(status: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    requested: ['طلب', 'Requested'],
    scheduled: ['مجدول', 'Scheduled'],
    completed: ['مكتمل', 'Completed'],
    no_show: ['لم يحضر', 'No-show'],
    cancelled: ['ملغى', 'Cancelled'],
    converted: ['تحوّل لحجز', 'Converted'],
  };
  const pair = map[status];
  return pair ? (ar ? pair[0] : pair[1]) : status;
}

function statusTone(status: string): string {
  switch (status) {
    case 'requested':
      return 'request';
    case 'scheduled':
      return 'scheduled';
    case 'completed':
    case 'converted':
      return 'done';
    case 'no_show':
      return 'missed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'neutral';
  }
}

function PassBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`vp-badge vp-badge--${tone}`}>{children}</span>;
}

export function ViewingPassCard({
  locale,
  token,
  initialPass = null,
}: {
  locale: 'ar' | 'en';
  token: string;
  initialPass?: PassPayload | null;
}) {
  const ar = locale === 'ar';
  const [pass, setPass] = useState<PassPayload | null>(initialPass);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preferredAt, setPreferredAt] = useState(() =>
    initialPass ? toLocalInputValue(initialPass.preferredAt || initialPass.scheduledAt) : '',
  );
  const [manageNote, setManageNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const applyPass = useCallback((body: PassPayload) => {
    setPass(body);
    setPreferredAt((current) => current || toLocalInputValue(body.preferredAt || body.scheduledAt));
  }, []);

  const loadPass = useCallback(async () => {
    const response = await fetch(`/api/viewing-pass?t=${encodeURIComponent(token)}`, {
      credentials: 'omit',
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as
      | PassPayload
      | { error?: { code?: string } }
      | null;
    if (!response.ok || !body || !('accessUsername' in body)) {
      throw new Error((body && 'error' in body && body.error?.code) || 'not_found');
    }
    return body;
  }, [token]);

  useEffect(() => {
    if (initialPass) return;
    let stopped = false;
    void (async () => {
      try {
        const body = await loadPass();
        if (!stopped) applyPass(body);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : 'load_failed');
      }
    })();
    return () => {
      stopped = true;
    };
  }, [applyPass, initialPass, loadPass]);

  // Poll until the guard checks the guest in so the book/decline prompt appears live.
  useEffect(() => {
    if (!pass || pass.arrivedAt || pass.guestDecision) return;
    if (pass.status === 'cancelled' || pass.status === 'no_show') return;
    const timer = window.setInterval(() => {
      void loadPass()
        .then((body) => {
          setPass((current) => {
            if (!current) return body;
            if (current.arrivedAt === body.arrivedAt && current.status === body.status) {
              return current.qrSvg ? current : body;
            }
            return { ...body, qrSvg: body.qrSvg ?? current.qrSvg };
          });
        })
        .catch(() => undefined);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [pass, loadPass]);

  async function postAction(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/viewing-pass', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | ViewingGuestPass
        | { ok: true; status: string; reference: string; id: string }
        | { error?: { code?: string } }
        | null;
      if (!response.ok || !body) {
        throw new Error((body && 'error' in body && body.error?.code) || 'decision_failed');
      }
      if ('accessUsername' in body) {
        setPass((current) => (current ? { ...current, ...body } : null));
        return body;
      }
      if ('ok' in body && body.ok) {
        setPass((current) =>
          current
            ? {
                ...current,
                status: body.status,
                arrivedAt: current.arrivedAt,
                guestDecision: current.guestDecision,
              }
            : null,
        );
        return body;
      }
      throw new Error('decision_failed');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'decision_failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: ViewingGuestDecision) {
    const result = await postAction({
      action: 'decision',
      token,
      decision,
      note: decisionNote.trim() || null,
    });
    if (result && 'accessUsername' in result) setDecisionNote('');
  }

  async function requestReschedule() {
    if (!preferredAt) {
      setError('viewing_schedule_invalid');
      return;
    }
    const result = await postAction({
      action: 'reschedule',
      token,
      preferredAt: new Date(preferredAt).toISOString(),
      note: manageNote.trim() || null,
    });
    if (result && 'accessUsername' in result) {
      setNotice(
        ar
          ? 'أرسلنا طلب تغيير الموعد للمالك. الموعد الحالي يبقى سارياً حتى يعتمد الموعد الجديد.'
          : 'We sent your new time to the owner. The current appointment stays until they confirm.',
      );
      setManageOpen(false);
    }
  }

  async function cancelVisit(reason: 'cancel' | 'not_attending') {
    const result = await postAction({
      action: reason,
      token,
      note: manageNote.trim() || null,
    });
    if (result && 'ok' in result) {
      setNotice(
        reason === 'not_attending'
          ? ar
            ? 'سجّلنا أنك لن تحضر. شكراً لإبلاغك.'
            : 'We recorded that you will not attend. Thank you for letting us know.'
          : ar
            ? 'تم إلغاء الموعد وإشعار المالك.'
            : 'The appointment was cancelled and the owner was notified.',
      );
      setManageOpen(false);
    }
  }

  if (error && !pass) {
    return (
      <div className="vp vp--empty">
        <p className="vp__banner vp__banner--err" role="alert">
          {ar ? 'بطاقة المعاينة غير صالحة أو منتهية.' : 'This viewing pass is invalid or expired.'}
        </p>
      </div>
    );
  }
  if (!pass) {
    return (
      <div className="vp vp--empty" role="status">
        <div className="vp__skeleton" aria-hidden="true" />
        <p className="vp__loading">{ar ? 'جارٍ تحميل بطاقة المعاينة…' : 'Loading viewing pass…'}</p>
      </div>
    );
  }

  const closed = pass.status === 'cancelled' || pass.status === 'no_show';
  const canManage =
    pass.status === 'scheduled' && !pass.arrivedAt && !pass.guestDecision && !closed;
  const showDecision = !pass.guestDecision && Boolean(pass.arrivedAt) && !closed;
  const waitingArrival = canManage;
  const purpose = pass.listingPurpose;
  const tone = statusTone(pass.status);
  const propertyTitle = ar ? pass.propertyNameAr : pass.propertyNameEn || pass.propertyNameAr;

  return (
    <div className={`vp vp--${tone}`}>
      <article className="vp__ticket">
        <header className="vp__ticket-head">
          <div>
            <p className="vp__brand">BHD R · {ar ? 'معاينة' : 'Viewing'}</p>
            <h1>{propertyTitle}</h1>
            <p className="vp__unit" dir="ltr">
              {pass.unitCode}
            </p>
          </div>
          <PassBadge tone={tone}>{statusLabel(pass.status, ar)}</PassBadge>
        </header>

        {closed ? (
          <p className="vp__banner vp__banner--warn" role="status">
            {pass.status === 'no_show'
              ? ar
                ? 'تم تسجيل عدم حضورك لهذا الموعد.'
                : 'This appointment was marked as not attended.'
              : ar
                ? 'تم إلغاء هذا الموعد.'
                : 'This appointment was cancelled.'}
          </p>
        ) : null}

        {!closed ? (
          <div className="vp__ticket-body">
            {pass.qrSvg && !pass.arrivedAt ? (
              <div className="vp__qr-well">
                <span
                  className="vp__qr"
                  role="img"
                  aria-label={ar ? 'باركود المعاينة' : 'Viewing barcode'}
                  dangerouslySetInnerHTML={{ __html: pass.qrSvg }}
                />
                <p>{ar ? 'اعرض هذا الرمز للحارس' : 'Show this code to the guard'}</p>
              </div>
            ) : null}

            <div className="vp__meta">
              <div className="vp__meta-row">
                <span>{ar ? 'الزائر' : 'Visitor'}</span>
                <strong>
                  <bdi>{pass.prospectName}</bdi>
                </strong>
              </div>
              <div className="vp__meta-row">
                <span>{ar ? 'المرجع' : 'Reference'}</span>
                <strong dir="ltr">{pass.reference}</strong>
              </div>
              <div className="vp__meta-row">
                <span>{ar ? 'الموعد' : 'Scheduled'}</span>
                <strong dir="ltr">{stamp(pass.scheduledAt, ar)}</strong>
              </div>
              {pass.preferredAt ? (
                <div className="vp__meta-row">
                  <span>{ar ? 'موعد بديل مطلوب' : 'Requested new time'}</span>
                  <strong dir="ltr">{stamp(pass.preferredAt, ar)}</strong>
                </div>
              ) : null}
              {pass.arrivedAt ? (
                <div className="vp__meta-row">
                  <span>{ar ? 'وقت الوصول' : 'Arrived'}</span>
                  <strong dir="ltr">{stamp(pass.arrivedAt, ar)}</strong>
                </div>
              ) : null}
            </div>

            {!pass.arrivedAt ? (
              <div className="vp__creds">
                <div className="vp__cred">
                  <span>{ar ? 'اسم المستخدم' : 'Username'}</span>
                  <strong dir="ltr">{pass.accessUsername}</strong>
                </div>
                <div className="vp__cred">
                  <span>{ar ? 'الرقم السري' : 'PIN'}</span>
                  <strong dir="ltr">
                    {pass.accessPin.slice(0, 3)} {pass.accessPin.slice(3)}
                  </strong>
                </div>
              </div>
            ) : null}

            {(pass.contactName || pass.contactPhone || pass.propertyAddress) && (
              <div className="vp__contact">
                {pass.contactName ? (
                  <div>
                    <span>{ar ? 'الحارس / المسؤول' : 'Guard / host'}</span>
                    <strong>{pass.contactName}</strong>
                  </div>
                ) : null}
                {pass.contactPhone ? (
                  <div>
                    <span>{ar ? 'هاتف الحارس' : 'Guard phone'}</span>
                    <strong dir="ltr">
                      <a href={`tel:${pass.contactPhone.replace(/[^\d+]/g, '')}`}>{pass.contactPhone}</a>
                    </strong>
                  </div>
                ) : null}
                {pass.propertyAddress ? (
                  <div className="vp__contact-wide">
                    <span>{ar ? 'الموقع' : 'Location'}</span>
                    <strong>{pass.propertyAddress}</strong>
                  </div>
                ) : null}
              </div>
            )}

            {pass.mapEmbedSrc || pass.propertyMapsUrl ? (
              <div className="vp__map-wrap">
                {pass.mapEmbedSrc ? (
                  <div
                    className="vp__map"
                    role={pass.propertyMapsUrl ? 'link' : undefined}
                    tabIndex={pass.propertyMapsUrl ? 0 : undefined}
                    aria-label={ar ? 'افتح موقع العقار على الخريطة' : 'Open property on the map'}
                    onClick={() => {
                      if (pass.propertyMapsUrl) {
                        window.open(pass.propertyMapsUrl, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    onKeyDown={(event) => {
                      if (!pass.propertyMapsUrl) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        window.open(pass.propertyMapsUrl, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <iframe
                      title={ar ? 'خريطة العقار' : 'Property map'}
                      src={pass.mapEmbedSrc}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      tabIndex={-1}
                    />
                  </div>
                ) : null}
                {pass.propertyMapsUrl ? (
                  <a
                    className="vp__map-link"
                    href={pass.propertyMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ar ? 'فتح في خرائط Google' : 'Open in Google Maps'}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      {waitingArrival ? (
        <p className="vp__banner vp__banner--wait" role="status">
          {ar
            ? 'اعرض الباركود أو بيانات الدخول للحارس عند وصولك. بعد تسجيل الحضور ستظهر خيارات الحجز أو الرفض تلقائياً.'
            : 'Show the barcode or credentials to the guard when you arrive. After check-in, book or decline options appear here automatically.'}
        </p>
      ) : null}

      {canManage ? (
        <section className="vp__panel" aria-labelledby="vp-manage-title">
          <div className="vp__panel-head">
            <h2 id="vp-manage-title">{ar ? 'إدارة الموعد' : 'Manage appointment'}</h2>
            <button
              type="button"
              className="button button--quiet button--tiny"
              onClick={() => setManageOpen((open) => !open)}
            >
              {manageOpen ? (ar ? 'إخفاء' : 'Hide') : ar ? 'تغيير أو إلغاء' : 'Change or cancel'}
            </button>
          </div>
          {manageOpen ? (
            <div className="vp__panel-body">
              <label className="field">
                <span>{ar ? 'موعد جديد مقترح' : 'Proposed new time'}</span>
                <input
                  type="datetime-local"
                  value={preferredAt}
                  onChange={(event) => setPreferredAt(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>{ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}</span>
                <textarea
                  rows={2}
                  value={manageNote}
                  onChange={(event) => setManageNote(event.target.value)}
                  disabled={busy}
                  maxLength={500}
                  placeholder={
                    ar ? 'مثال: أحتاج موعداً مساءً بعد العمل' : 'e.g. I need an evening slot after work'
                  }
                />
              </label>
              <div className="vp__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || !preferredAt}
                  onClick={() => void requestReschedule()}
                >
                  {ar ? 'طلب تغيير الموعد' : 'Request new time'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => void cancelVisit('not_attending')}
                >
                  {ar ? 'لن أحضر' : 'I will not attend'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => void cancelVisit('cancel')}
                >
                  {ar ? 'إلغاء الموعد' : 'Cancel appointment'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {notice ? (
        <p className="vp__banner vp__banner--ok" role="status">
          {notice}
        </p>
      ) : null}

      {pass.guestDecision ? (
        <p className="vp__banner vp__banner--ok" role="status">
          {pass.guestDecision === 'declined'
            ? ar
              ? 'سجّلنا أنك لست راغباً حالياً. شكراً لزيارتك.'
              : 'We recorded that you are not interested for now. Thank you for visiting.'
            : pass.guestDecision === 'book_sale'
              ? ar
                ? 'اخترت متابعة الشراء — أكمل البيانات من صفحة الوحدة.'
                : 'You chose to proceed with purchase — complete the details on the unit page.'
              : ar
                ? 'اخترت الاستئجار — أكمل بيانات الإيجار من صفحة الحجز.'
                : 'You chose to rent — complete the rental details on the booking page.'}
        </p>
      ) : null}

      {showDecision ? (
        <section className="vp__decision" aria-labelledby="vp-decision-title">
          <h2 id="vp-decision-title">{ar ? 'بعد المعاينة' : 'After the viewing'}</h2>
          <p>
            {ar
              ? 'تم تسجيل وصولك. يمكنك كتابة ملاحظة اختيارية ثم اختيار المتابعة أو الرفض.'
              : 'Your arrival is recorded. Leave an optional note, then continue or decline.'}
          </p>
          <label className="field">
            <span>{ar ? 'ملاحظة للمالك (اختياري)' : 'Note for the owner (optional)'}</span>
            <textarea
              rows={3}
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              disabled={busy}
              maxLength={500}
              placeholder={
                ar
                  ? 'مثال: أرغب بعقد سنوي يبدأ الشهر القادم — أو اتركه فارغاً'
                  : 'e.g. I want a yearly lease starting next month — or leave blank'
              }
            />
          </label>
          <div className="vp__actions">
            {purpose === 'rent' || purpose === 'both' ? (
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void decide('book_rent')}
              >
                {ar ? 'أرغب بالاستئجار' : 'I want to rent'}
              </button>
            ) : null}
            {purpose === 'sale' || purpose === 'both' ? (
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void decide('book_sale')}
              >
                {ar ? 'أرغب بالشراء' : 'I want to buy'}
              </button>
            ) : null}
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void decide('declined')}
            >
              {ar ? 'رفض التأجير / الشراء' : 'Decline rent / sale'}
            </button>
          </div>
        </section>
      ) : null}

      {pass.guestDecision === 'book_rent' ? (
        <p className="vp__cta">
          <Link className="button button--primary" href={`/${locale}/book/${pass.unitId}?mode=rent`}>
            {ar ? 'إكمال بيانات الاستئجار' : 'Complete rental details'}
          </Link>
        </p>
      ) : null}
      {pass.guestDecision === 'book_sale' ? (
        <p className="vp__cta">
          <Link className="button button--primary" href={`/${locale}/book/${pass.unitId}?mode=sale`}>
            {ar ? 'إكمال بيانات الشراء' : 'Complete purchase details'}
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className="vp__banner vp__banner--err" role="alert">
          {errorMessage(error, ar)}
        </p>
      ) : null}
    </div>
  );
}
