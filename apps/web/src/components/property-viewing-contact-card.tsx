'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { InternationalPhoneField } from '@/components/international-phone-field';
import type { PropertyViewingContact } from '@/lib/property-viewing-contact-neon';

function roleLabel(roleKey: string, ar: boolean): string {
  if (roleKey === 'building_guard') return ar ? 'حارس مبنى' : 'Building guard';
  if (roleKey === 'property_manager') return ar ? 'مدير عقار' : 'Property manager';
  if (roleKey === 'admin_staff') return ar ? 'موظف إداري' : 'Admin staff';
  if (roleKey === 'maintenance_agent') return ar ? 'صيانة' : 'Maintenance';
  return roleKey;
}

/** Same-origin relative path only — blocks open redirects. */
function safePortalReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return null;
  if (!/^\/(ar|en)\/(owner|developer)\//.test(raw)) return null;
  return raw;
}

export function PropertyViewingContactCard({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safePortalReturnTo(searchParams.get('returnTo'));
  const teamHref = `/${locale}/owner/team`;
  const [detail, setDetail] = useState<PropertyViewingContact | null>(null);
  const [selected, setSelected] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/owner/properties/${encodeURIComponent(propertyId)}/viewing-contact`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        const body = (await response.json().catch(() => null)) as
          | PropertyViewingContact
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('propertyId' in body)) {
          setError((body && 'error' in body && body.error?.code) || 'load_failed');
          return;
        }
        setDetail(body);
        setSelected(body.contactUserId ?? '');
        setPhone(body.contactPhone ?? '');
      } catch {
        if (!stopped) setError('load_failed');
      }
    })();
    return () => {
      stopped = true;
    };
  }, [propertyId]);

  function pickCandidate(userId: string) {
    setSelected(userId);
    setSaved(false);
    const match = detail?.candidates.find((person) => person.userId === userId);
    setPhone(match?.phone ?? '');
  }

  async function save() {
    if (selected && phone.trim().length < 8) {
      setError(ar ? 'رقم هاتف الحارس مطلوب للتواصل.' : 'Guard phone number is required.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/owner/properties/${encodeURIComponent(propertyId)}/viewing-contact`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-csrf-token': await fetchBrowserCsrfToken(),
          },
          body: JSON.stringify({
            contactUserId: selected || null,
            phone: selected ? phone.trim() : null,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | PropertyViewingContact
        | { error?: { code?: string } }
        | null;
      if (!response.ok || !body || !('propertyId' in body)) {
        const code = (body && 'error' in body && body.error?.code) || 'update_failed';
        if (code === 'viewing_contact_phone_required') {
          throw new Error(
            ar ? 'أدخل رقم هاتف الحارس قبل الحفظ.' : 'Enter the guard’s phone before saving.',
          );
        }
        if (code === 'viewing_contact_phone_invalid') {
          throw new Error(ar ? 'رقم الهاتف غير صالح.' : 'Phone number is invalid.');
        }
        throw new Error(code);
      }
      setDetail(body);
      setSelected(body.contactUserId ?? '');
      setPhone(body.contactPhone ?? '');
      setSaved(true);
      if (returnTo && body.contactUserId && body.contactPhone) {
        router.push(returnTo);
        router.refresh();
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'update_failed');
    } finally {
      setBusy(false);
    }
  }

  const phoneOk = !selected || phone.trim().length >= 8;
  const unchanged =
    selected === (detail?.contactUserId ?? '') &&
    phone.trim() === (detail?.contactPhone ?? '').trim();

  return (
    <section
      className="pmh-card property-viewing-contact"
      aria-labelledby="viewing-contact-title"
      id="viewing-contact"
    >
      <header className="pmh-card__head">
        <h2 id="viewing-contact-title">
          {ar ? 'مسؤول المعاينة / حارس المبنى' : 'Viewing contact / building guard'}
        </h2>
      </header>
      <p className="muted">
        {ar
          ? 'حدّد من يستقبل زائر المعاينة ويمسح باركوده عند الوصول، مع رقم هاتف للتواصل يظهر على بطاقة الزائر. لن يُفعَّل تأكيد الموعد قبل اختيار المسؤول ورقم هاتفه.'
          : 'Choose who greets viewing guests and scans their pass, with a phone number shown on the guest pass. Scheduling stays locked until a contact and phone are set.'}
      </p>
      {returnTo ? (
        <p className="notice" role="status">
          {ar
            ? 'بعد الحفظ ستُعاد إلى طلب المعاينة لإكمال تأكيد الموعد.'
            : 'After saving you will return to the viewing request to confirm the schedule.'}
        </p>
      ) : null}
      {!detail && !error ? (
        <p className="muted" role="status">
          {ar ? 'جارٍ التحميل…' : 'Loading…'}
        </p>
      ) : null}
      {detail ? (
        <div className="property-viewing-contact__form">
          <label className="field">
            <span>{ar ? 'المسؤول عن المعاينة' : 'Viewing responsible'}</span>
            <select
              className="select"
              value={selected}
              onChange={(event) => pickCandidate(event.target.value)}
            >
              <option value="">
                {ar ? '— اختر حارساً أو مسؤولاً —' : '— Choose a guard or staff —'}
              </option>
              {detail.candidates.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                  {person.roleKey ? ` · ${roleLabel(person.roleKey, ar)}` : ''}
                  {person.phone ? ` · ${person.phone}` : ar ? ' · بلا هاتف' : ' · no phone'}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <InternationalPhoneField
              id="viewing-contact-phone"
              label={ar ? 'هاتف الحارس (للتواصل)' : 'Guard phone (for contact)'}
              value={phone}
              onChange={(value) => {
                setPhone(value);
                setSaved(false);
              }}
              locale={locale}
              required
              hint={
                ar
                  ? 'يظهر للزائر على بطاقة المعاينة للاتصال عند الوصول.'
                  : 'Shown to the guest on the viewing pass so they can call on arrival.'
              }
            />
          ) : null}
          {detail.candidates.length <= 1 ? (
            <p className="notice" role="status">
              {ar ? (
                <>
                  لإضافة حارس أو مسؤول آخر: افتح{' '}
                  <Link href={teamHref}>الفريق</Link> → دعوة عضو → الدور{' '}
                  <strong>حارس مبنى</strong> (أو مدير عقار / موظف إداري). بعد قبول الدعوة يظهر هنا.
                </>
              ) : (
                <>
                  To add another guard or staff member: open{' '}
                  <Link href={teamHref}>Team</Link> → invite → role{' '}
                  <strong>Building guard</strong> (or property manager / admin staff). They appear
                  here after accepting.
                </>
              )}
            </p>
          ) : null}
          {!detail.candidates.length ? (
            <p className="notice notice--error" role="alert">
              {ar
                ? 'لا يوجد أعضاء فريق بعد. أضف حارس مبنى من صفحة الفريق أولاً.'
                : 'No team members yet. Add a building guard on the team page first.'}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={busy || unchanged || Boolean(returnTo && !selected) || !phoneOk}
            onClick={() => void save()}
          >
            {busy
              ? ar
                ? 'جارٍ الحفظ…'
                : 'Saving…'
              : returnTo
                ? ar
                  ? 'حفظ والعودة لطلب المعاينة'
                  : 'Save and return to viewing'
                : ar
                  ? 'حفظ المسؤول'
                  : 'Save contact'}
          </button>
          {saved && !returnTo ? (
            <p className="notice notice--success" role="status">
              {ar ? 'تم حفظ مسؤول المعاينة ورقم الهاتف.' : 'Viewing contact and phone saved.'}
            </p>
          ) : null}
          {detail.contactName ? (
            <p className="muted">
              {ar ? 'الحالي: ' : 'Current: '}
              <strong>{detail.contactName}</strong>
              {detail.contactPhone ? (
                <>
                  {' · '}
                  <span dir="ltr">{detail.contactPhone}</span>
                </>
              ) : (
                <span className="notice notice--error">
                  {ar ? ' — أضف رقم الهاتف' : ' — add a phone number'}
                </span>
              )}
            </p>
          ) : (
            <p className="notice" role="status">
              {ar
                ? 'لم يُحدَّد مسؤول بعد — طلبات المعاينة لن تُؤكَّد.'
                : 'No contact yet — viewing requests cannot be confirmed.'}
            </p>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
