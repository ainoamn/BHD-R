'use client';

import { useCallback, useEffect, useState } from 'react';
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

export function ViewingPassCard({
  locale,
  token,
}: {
  locale: 'ar' | 'en';
  token: string;
}) {
  const ar = locale === 'ar';
  const [pass, setPass] = useState<PassPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preferredAt, setPreferredAt] = useState('');
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
  }, [applyPass, loadPass]);

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
      <p className="notice notice--error" role="alert">
        {ar ? 'بطاقة المعاينة غير صالحة أو منتهية.' : 'This viewing pass is invalid or expired.'}
      </p>
    );
  }
  if (!pass) {
    return (
      <p className="muted" role="status">
        {ar ? 'جارٍ تحميل بطاقة المعاينة…' : 'Loading viewing pass…'}
      </p>
    );
  }

  const closed = pass.status === 'cancelled' || pass.status === 'no_show';
  const canManage =
    pass.status === 'scheduled' && !pass.arrivedAt && !pass.guestDecision && !closed;
  const showDecision = !pass.guestDecision && Boolean(pass.arrivedAt) && !closed;
  const waitingArrival = canManage;
  const purpose = pass.listingPurpose;

  return (
    <div className="viewing-pass">
      <header className="viewing-pass__head">
        <span className="ops-kicker">BHD R · VIEWING</span>
        <h1>{ar ? 'بطاقة معاينة العقار' : 'Property viewing pass'}</h1>
        <p className="muted">
          {ar ? pass.propertyNameAr : pass.propertyNameEn || pass.propertyNameAr}
          {' · '}
          {pass.unitCode}
        </p>
      </header>

      {closed ? (
        <p className="notice" role="status">
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
        <div className="viewing-pass__body">
          {pass.qrSvg && !pass.arrivedAt ? (
            <span
              className="viewing-pass__qr"
              role="img"
              aria-label={ar ? 'باركود المعاينة' : 'Viewing barcode'}
              dangerouslySetInnerHTML={{ __html: pass.qrSvg }}
            />
          ) : null}
          <dl className="viewing-pass__facts">
            <div>
              <dt>{ar ? 'الزائر' : 'Visitor'}</dt>
              <dd>
                <bdi>{pass.prospectName}</bdi>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المرجع' : 'Reference'}</dt>
              <dd dir="ltr">{pass.reference}</dd>
            </div>
            {!pass.arrivedAt ? (
              <>
                <div>
                  <dt>{ar ? 'اسم المستخدم' : 'Username'}</dt>
                  <dd dir="ltr" className="viewing-pass__code">
                    {pass.accessUsername}
                  </dd>
                </div>
                <div>
                  <dt>{ar ? 'الرقم السري' : 'PIN'}</dt>
                  <dd dir="ltr" className="viewing-pass__code">
                    {pass.accessPin.slice(0, 3)} {pass.accessPin.slice(3)}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{ar ? 'الموعد' : 'Scheduled'}</dt>
              <dd dir="ltr">{stamp(pass.scheduledAt, ar)}</dd>
            </div>
            {pass.preferredAt ? (
              <div>
                <dt>{ar ? 'موعد بديل مطلوب' : 'Requested new time'}</dt>
                <dd dir="ltr">{stamp(pass.preferredAt, ar)}</dd>
              </div>
            ) : null}
            {pass.contactName ? (
              <div>
                <dt>{ar ? 'الحارس / المسؤول' : 'Guard / host'}</dt>
                <dd>{pass.contactName}</dd>
              </div>
            ) : null}
            {pass.contactPhone ? (
              <div>
                <dt>{ar ? 'هاتف الحارس' : 'Guard phone'}</dt>
                <dd dir="ltr">
                  <a href={`tel:${pass.contactPhone.replace(/[^\d+]/g, '')}`}>{pass.contactPhone}</a>
                </dd>
              </div>
            ) : null}
            {pass.propertyAddress ? (
              <div>
                <dt>{ar ? 'الموقع' : 'Location'}</dt>
                <dd>{pass.propertyAddress}</dd>
              </div>
            ) : null}
            {pass.arrivedAt ? (
              <div>
                <dt>{ar ? 'وقت الوصول' : 'Arrived'}</dt>
                <dd dir="ltr">{stamp(pass.arrivedAt, ar)}</dd>
              </div>
            ) : null}
          </dl>
          {pass.mapEmbedSrc || pass.propertyMapsUrl ? (
            <div className="viewing-pass__map-wrap">
              {pass.mapEmbedSrc ? (
                <div
                  className="viewing-pass__map"
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
                <p>
                  <a href={pass.propertyMapsUrl} target="_blank" rel="noreferrer" dir="ltr">
                    {ar ? 'فتح في خرائط Google' : 'Open in Google Maps'}
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {waitingArrival ? (
        <p className="viewing-pass__note viewing-pass__note--wait" role="status">
          {ar
            ? 'اعرض الباركود أو بيانات الدخول على الحارس عند وصولك. بعد تسجيل الحضور ستظهر لك خيارات متابعة الحجز أو الرفض تلقائياً.'
            : 'Show the barcode or credentials to the guard when you arrive. After check-in, options to continue booking or decline will appear here automatically.'}
        </p>
      ) : null}

      {canManage ? (
        <section className="viewing-pass__manage" aria-labelledby="viewing-manage-title">
          <div className="viewing-pass__manage-head">
            <h2 id="viewing-manage-title">{ar ? 'إدارة الموعد' : 'Manage appointment'}</h2>
            <button
              type="button"
              className="button button--quiet button--tiny"
              onClick={() => setManageOpen((open) => !open)}
            >
              {manageOpen ? (ar ? 'إخفاء' : 'Hide') : ar ? 'تغيير أو إلغاء' : 'Change or cancel'}
            </button>
          </div>
          {manageOpen ? (
            <div className="viewing-pass__manage-body">
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
              <div className="viewing-pass__actions">
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
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}

      {pass.guestDecision ? (
        <p className="notice notice--success" role="status">
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
        <section className="viewing-pass__decision" aria-labelledby="viewing-decision-title">
          <h2 id="viewing-decision-title">{ar ? 'بعد المعاينة' : 'After the viewing'}</h2>
          <p className="muted">
            {ar
              ? 'تم تسجيل وصولك. يمكنك كتابة ملاحظة اختيارية ثم اختيار المتابعة أو الرفض، أو المتابعة مباشرة بلا تعليق.'
              : 'Your arrival is recorded. You may leave an optional note, then choose to continue or decline — or proceed with no comment.'}
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
          <div className="viewing-pass__actions">
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
        <p>
          <Link className="button button--primary" href={`/${locale}/book/${pass.unitId}?mode=rent`}>
            {ar ? 'إكمال بيانات الاستئجار' : 'Complete rental details'}
          </Link>
        </p>
      ) : null}
      {pass.guestDecision === 'book_sale' ? (
        <p>
          <Link className="button button--primary" href={`/${locale}/book/${pass.unitId}?mode=sale`}>
            {ar ? 'إكمال بيانات الشراء' : 'Complete purchase details'}
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className="notice notice--error" role="alert">
          {errorMessage(error, ar)}
        </p>
      ) : null}
    </div>
  );
}
