'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
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
  const [detail, setDetail] = useState<PropertyViewingContact | null>(null);
  const [selected, setSelected] = useState('');
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
      } catch {
        if (!stopped) setError('load_failed');
      }
    })();
    return () => {
      stopped = true;
    };
  }, [propertyId]);

  async function save() {
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
          body: JSON.stringify({ contactUserId: selected || null }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | PropertyViewingContact
        | { error?: { code?: string } }
        | null;
      if (!response.ok || !body || !('propertyId' in body)) {
        throw new Error((body && 'error' in body && body.error?.code) || 'update_failed');
      }
      setDetail(body);
      setSelected(body.contactUserId ?? '');
      setSaved(true);
      if (returnTo && body.contactUserId) {
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
          ? 'حدّد من يستقبل زائر المعاينة ويمسح باركوده عند الوصول. لن يُفعَّل تأكيد الموعد وإشعار العميل قبل اختيار المسؤول.'
          : 'Choose who greets viewing guests and scans their pass on arrival. Scheduling and guest notification stay locked until a contact is set.'}
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
              onChange={(event) => {
                setSelected(event.target.value);
                setSaved(false);
              }}
            >
              <option value="">
                {ar ? '— اختر حارساً أو مسؤولاً —' : '— Choose a guard or staff —'}
              </option>
              {detail.candidates.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                  {person.roleKey ? ` · ${roleLabel(person.roleKey, ar)}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!detail.candidates.length ? (
            <p className="notice notice--error" role="alert">
              {ar
                ? 'لا يوجد أعضاء فريق بصلاحية الميدان بعد. أضف حارس مبنى أو موظفاً من صفحة الفريق أولاً.'
                : 'No field staff yet. Add a building guard or staff member on the team page first.'}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={
              busy ||
              selected === (detail.contactUserId ?? '') ||
              Boolean(returnTo && !selected)
            }
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
              {ar ? 'تم حفظ مسؤول المعاينة.' : 'Viewing contact saved.'}
            </p>
          ) : null}
          {detail.contactName ? (
            <p className="muted">
              {ar ? 'الحالي: ' : 'Current: '}
              <strong>{detail.contactName}</strong>
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
