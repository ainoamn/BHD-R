'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch(`/api/viewing-pass?t=${encodeURIComponent(token)}`, {
          credentials: 'omit',
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => null)) as
          | PassPayload
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('accessUsername' in body)) {
          setError((body && 'error' in body && body.error?.code) || 'not_found');
          return;
        }
        setPass(body);
      } catch {
        if (!stopped) setError('load_failed');
      }
    })();
    return () => {
      stopped = true;
    };
  }, [token]);

  async function decide(decision: ViewingGuestDecision) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/viewing-pass', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token, decision }),
      });
      const body = (await response.json().catch(() => null)) as
        | ViewingGuestPass
        | { error?: { code?: string } }
        | null;
      if (!response.ok || !body || !('accessUsername' in body)) {
        throw new Error((body && 'error' in body && body.error?.code) || 'decision_failed');
      }
      setPass((current) => (current ? { ...current, ...body } : null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'decision_failed');
    } finally {
      setBusy(false);
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

  const scheduledPassed =
    Boolean(pass.scheduledAt) && new Date(pass.scheduledAt!).getTime() <= Date.now();
  const showDecision =
    !pass.guestDecision &&
    (Boolean(pass.arrivedAt) || pass.status === 'completed' || scheduledPassed);
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

      <div className="viewing-pass__body">
        {pass.qrSvg ? (
          <span
            className="viewing-pass__qr"
            role="img"
            aria-label={ar ? 'باركود المعاينة' : 'Viewing barcode'}
            dangerouslySetInnerHTML={{ __html: pass.qrSvg }}
          />
        ) : null}
        <dl className="viewing-pass__facts">
          <div>
            <dt>{ar ? 'المرجع' : 'Reference'}</dt>
            <dd dir="ltr">{pass.reference}</dd>
          </div>
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
          <div>
            <dt>{ar ? 'الموعد' : 'Scheduled'}</dt>
            <dd dir="ltr">{stamp(pass.scheduledAt, ar)}</dd>
          </div>
          {pass.arrivedAt ? (
            <div>
              <dt>{ar ? 'وقت الوصول' : 'Arrived'}</dt>
              <dd dir="ltr">{stamp(pass.arrivedAt, ar)}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <p className="viewing-pass__note">
        {ar
          ? 'اعرض هذا الباركود أو البيانات على حارس المبنى أو المسؤول عند وصولك لتوثيق حضورك.'
          : 'Show this barcode or credentials to the building guard when you arrive so your visit is recorded.'}
      </p>

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
              ? 'هل ترغب بالحجز أو ترفض التأجير/الشراء؟'
              : 'Would you like to book, or decline renting/buying?'}
          </p>
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
          {error}
        </p>
      ) : null}
    </div>
  );
}
