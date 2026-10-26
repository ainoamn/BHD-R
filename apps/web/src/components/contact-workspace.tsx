'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { PartyBadgesPanel } from '@/components/badges/subject-badges-panel';
import { BadgeChips } from '@/components/badges/badge-chips';
import { BilingualNameField } from '@/components/bilingual-name-field';
import { IdentityAvatar, VerifiedMark } from '@/components/identity/verified-mark';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  CLOSED_LEGAL,
  CONTACT_ROLE_KEYS,
  MONEY_LINE_LABELS,
  OPEN_MAINTENANCE,
  arPlural,
  contactRoleLabel,
  type ContactDetail,
  type ContactPlace,
  type ContactUpdate,
  type MoneyTotals,
} from '@/lib/contacts-shared';
import { formatMoney } from '@/lib/format';
import { LEGAL_STAGE_LABELS, type LegalStage } from '@/lib/legal-case-shared';
import type { PortalRole } from '@/lib/types';

const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  active: { ar: 'ساري', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
  cancel_requested: { ar: 'طلب إلغاء', en: 'Cancel requested' },
  clearance_pending: { ar: 'بانتظار التصفية', en: 'Clearance pending' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  ended: { ar: 'منتهٍ', en: 'Ended' },
  terminated: { ar: 'مُنهى', en: 'Terminated' },
  sent: { ar: 'مُرسل للتوقيع', en: 'Sent' },
  partially_signed: { ar: 'موقّع جزئياً', en: 'Partially signed' },
  signed: { ar: 'موقّع', en: 'Signed' },
  pending: { ar: 'بانتظار الدفع', en: 'Pending' },
  confirmed: { ar: 'مؤكد', en: 'Confirmed' },
  converted: { ar: 'تحوّل إلى عقد', en: 'Converted' },
  expired: { ar: 'منتهي الصلاحية', en: 'Expired' },
  request_pending: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval' },
  pre_arrival: { ar: 'قبل الوصول', en: 'Pre-arrival' },
  checked_in: { ar: 'مقيم الآن', en: 'Checked in' },
  checked_out: { ar: 'غادر', en: 'Checked out' },
  closed: { ar: 'مغلق', en: 'Closed' },
  open: { ar: 'مفتوح', en: 'Open' },
  assigned: { ar: 'مُسند', en: 'Assigned' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  resolved: { ar: 'تم الحل', en: 'Resolved' },
};

function statusLabel(status: string, ar: boolean): string {
  const label =
    STATUS_LABELS[status] ??
    (LEGAL_STAGE_LABELS as Record<string, { ar: string; en: string }>)[status];
  return label ? (ar ? label.ar : label.en) : status;
}

function money(totals: MoneyTotals, locale: 'ar' | 'en'): string {
  if (!totals.length) return formatMoney('0', 'OMR', locale);
  return totals.map((item) => formatMoney(item.minor, item.currency, locale)).join(' + ');
}

function formatDay(value: string | null, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    timeZone: value.length === 10 ? 'UTC' : 'Asia/Muscat',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function Place({ row, ar }: { row: ContactPlace; ar: boolean }) {
  const name = ar ? row.propertyNameAr : row.propertyNameEn || row.propertyNameAr;
  return (
    <>
      {name || '—'}
      {row.unitCode ? (
        <>
          {' — '}
          <bdi className="contact-code">{row.unitCode}</bdi>
        </>
      ) : null}
    </>
  );
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section id={id} className="contact-section">
      <h2>
        {title} <span>{count}</span>
      </h2>
      {children}
    </section>
  );
}

type FormState = {
  displayName: string;
  nameEn: string;
  type: 'person' | 'company';
  phone: string;
  email: string;
  status: 'active' | 'inactive' | 'archived';
  roles: string[];
  notes: string;
  governorate: string;
  wilayat: string;
  city: string;
  area: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
};

function formFrom(detail: ContactDetail): FormState {
  const { party } = detail;
  return {
    displayName: party.displayName,
    nameEn: party.nameEn ?? '',
    type: party.type,
    phone: party.phone ?? '',
    email: party.email ?? '',
    status: (['active', 'inactive', 'archived'].includes(party.status)
      ? party.status
      : 'active') as FormState['status'],
    roles: party.roles,
    notes: party.notes ?? '',
    governorate: party.address?.governorate ?? '',
    wilayat: party.address?.wilayat ?? '',
    city: party.address?.city ?? '',
    area: party.address?.area ?? '',
    street: party.address?.street ?? '',
    buildingNumber: party.address?.buildingNumber ?? '',
    postalCode: party.address?.postalCode ?? '',
  };
}

const ERRORS: Record<string, { ar: string; en: string }> = {
  contact_email_taken: {
    ar: 'هذا البريد مسجّل لطرف آخر في دفتر العناوين.',
    en: 'This email belongs to another party in the address book.',
  },
  contact_invalid: {
    ar: 'تحقق من الحقول: الاسم مطلوب، والبريد والهاتف بصيغة صحيحة، والعنوان يحتاج المحافظة والولاية والمدينة.',
    en: 'Check the fields: name is required, email and phone must be valid, and an address needs governorate, wilayat and city.',
  },
  forbidden: {
    ar: 'صلاحيات حسابك لا تسمح بتعديل الأطراف.',
    en: 'Your account may not edit parties.',
  },
};

/** One party: details and edit form, the buildings they own or rent, their money and files. */
export function ContactWorkspace({
  initial,
  locale,
  portal,
}: {
  initial: ContactDetail;
  locale: 'ar' | 'en';
  portal: PortalRole;
}) {
  const ar = locale === 'ar';
  const [detail, setDetail] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => formFrom(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const { party, money: totals } = detail;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function reload() {
    const response = await fetch(`/api/portal/contacts/${encodeURIComponent(party.id)}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (response.ok) {
      const next = (await response.json()) as ContactDetail;
      setDetail(next);
      setForm(formFrom(next));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const hasAddress = [form.governorate, form.wilayat, form.city].some((value) => value.trim());
    const body: ContactUpdate = {
      displayName: form.displayName,
      nameEn: form.nameEn.trim() || null,
      type: form.type,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      status: form.status,
      roles: form.roles,
      notes: form.notes.trim() || null,
      address: hasAddress
        ? {
            governorate: form.governorate,
            wilayat: form.wilayat,
            city: form.city,
            area: form.area.trim() || null,
            street: form.street.trim() || null,
            buildingNumber: form.buildingNumber.trim() || null,
            postalCode: form.postalCode.trim() || null,
          }
        : party.address
          ? null
          : undefined,
    };
    try {
      const result = await browserNextMutation<{ changed: string[] }>(
        `/api/portal/contacts/${encodeURIComponent(party.id)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      await reload();
      setEditing(false);
      setMessage({
        tone: 'ok',
        text: result.changed.length
          ? ar
            ? 'حُفظت التعديلات.'
            : 'Changes saved.'
          : ar
            ? 'لا توجد تغييرات للحفظ.'
            : 'Nothing to save.',
      });
      window.dispatchEvent(
        new CustomEvent('bhd-r-ops-refresh', { detail: { section: 'contacts' } }),
      );
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      const known = ERRORS[code];
      setMessage({
        tone: 'error',
        text: known
          ? ar
            ? known.ar
            : known.en
          : ar
            ? 'تعذّر حفظ التعديلات. حاول مجدداً.'
            : 'Could not save the changes. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  const openMaintenance = detail.maintenance.filter((row) => OPEN_MAINTENANCE.has(row.status));
  const openLegal = detail.legal.filter((row) => !CLOSED_LEGAL.has(row.status));
  const liveLeases = detail.leases.filter((row) =>
    ['active', 'cancel_requested', 'clearance_pending'].includes(row.status),
  );
  const isOwner = detail.owned.length > 0;
  const addressLine = party.address
    ? [
        party.address.buildingNumber,
        party.address.street,
        party.address.area,
        party.address.city,
        party.address.wilayat,
        party.address.governorate,
      ]
        .filter(Boolean)
        .join('، ')
    : null;
  const whatsapp = party.phone?.replace(/[^0-9]/g, '');
  const sections = [
    {
      id: 'owned',
      ar: 'المباني والعقارات التي يملكها',
      en: 'Properties owned',
      count: detail.owned.length,
    },
    { id: 'leases', ar: 'ما يستأجره', en: 'Rented units', count: detail.leases.length },
    { id: 'contracts', ar: 'العقود', en: 'Contracts', count: detail.contracts.length },
    {
      id: 'reservations',
      ar: 'حجوزات الإيجار والشراء',
      en: 'Rent & purchase bookings',
      count: detail.reservations.length,
    },
    { id: 'stays', ar: 'الإقامات اليومية', en: 'Daily stays', count: detail.stays.length },
    { id: 'maintenance', ar: 'الصيانة', en: 'Maintenance', count: detail.maintenance.length },
    { id: 'legal', ar: 'القضايا', en: 'Legal cases', count: detail.legal.length },
    { id: 'tasks', ar: 'المهام', en: 'Tasks', count: detail.tasks.length },
  ].filter((item) => item.count > 0);

  return (
    <div className="contact-page">
      <Link className="contact-page__back" href={`/${portal}/contacts`}>
        {ar ? '→ الأطراف ودفتر العناوين' : '← Parties & address book'}
      </Link>

      <header className="contact-hero">
        {party.mark?.avatarUrl ? (
          <IdentityAvatar
            name={party.displayName}
            mark={party.mark}
            locale={locale}
            size={72}
            className="contact-hero__avatar"
          />
        ) : (
          <span className="contact-hero__avatar" aria-hidden="true">
            {party.displayName.trim().charAt(0).toUpperCase() || '؟'}
          </span>
        )}
        <div className="contact-hero__main">
          <h1 className="name-with-mark">
            {party.displayName}
            <VerifiedMark verified={party.mark?.verified} locale={locale} size={22} />
          </h1>
          <BadgeChips badges={party.badges} locale={locale} labelled size={22} max={5} />
          {party.mark ? (
            <p className={`account-status${party.mark.verified ? ' is-verified' : ''}`}>
              {party.mark.verified
                ? ar
                  ? 'حساب موثّق: طابق فريق بن حمود اسمه مع مستند رسمي'
                  : 'Verified: BHD matched the name with an official document'
                : ar
                  ? 'غير موثّق'
                  : 'Not verified'}
            </p>
          ) : null}
          <div className="contact-card__roles">
            <span className="contact-role contact-role--muted">
              {party.type === 'company' ? (ar ? 'شركة' : 'Company') : ar ? 'فرد' : 'Person'}
            </span>
            {isOwner && !party.roles.includes('owner') ? (
              <span className="contact-role contact-role--owner">
                {contactRoleLabel('owner', ar)}
              </span>
            ) : null}
            {liveLeases.length && !party.roles.includes('tenant') ? (
              <span className="contact-role contact-role--tenant">
                {contactRoleLabel('tenant', ar)}
              </span>
            ) : null}
            {party.roles.map((role) => (
              <span key={role} className={`contact-role contact-role--${role}`}>
                {contactRoleLabel(role, ar)}
              </span>
            ))}
            {party.member ? (
              <span className="contact-role contact-role--member">
                {ar ? 'عضو بالفريق' : 'Team member'}
              </span>
            ) : null}
            {party.status !== 'active' ? (
              <span className="contact-role contact-role--muted">
                {statusLabel(party.status, ar)}
              </span>
            ) : null}
          </div>
          <dl className="contact-hero__facts">
            <div>
              <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
              <dd>
                {party.phone ? (
                  <bdi>
                    <a href={`tel:${party.phone}`}>{party.phone}</a>
                  </bdi>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'البريد' : 'Email'}</dt>
              <dd>
                {party.email ? (
                  <bdi>
                    <a href={`mailto:${party.email}`}>{party.email}</a>
                  </bdi>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'العنوان' : 'Address'}</dt>
              <dd>{addressLine || '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'أُضيف في' : 'Added'}</dt>
              <dd>{formatDay(party.createdAt, ar)}</dd>
            </div>
          </dl>
          {party.notes ? <p className="contact-hero__notes">{party.notes}</p> : null}
        </div>
        <div className="contact-hero__actions">
          {whatsapp ? (
            <a
              className="button button--secondary"
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? 'واتساب' : 'WhatsApp'}
            </a>
          ) : null}
          {detail.canEdit ? (
            <button
              type="button"
              className="button button--primary"
              aria-expanded={editing}
              onClick={() => {
                setForm(formFrom(detail));
                setMessage(null);
                setEditing((value) => !value);
              }}
            >
              {editing
                ? ar
                  ? 'إلغاء التعديل'
                  : 'Cancel edit'
                : ar
                  ? 'تعديل البيانات'
                  : 'Edit details'}
            </button>
          ) : null}
        </div>
      </header>

      <PartyBadgesPanel partyId={party.id} locale={locale} portal={portal} />

      {message ? (
        <p
          className={`contact-message contact-message--${message.tone}`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      {editing ? (
        <form className="contact-edit" onSubmit={(event) => void save(event)}>
          <fieldset>
            <legend>{ar ? 'البيانات الأساسية' : 'Details'}</legend>
            <BilingualNameField
              idPrefix="contact-name"
              labelAr={ar ? 'الاسم بالعربية' : 'Name (Arabic)'}
              labelEn={ar ? 'الاسم بالإنجليزية' : 'Name (English)'}
              valueAr={form.displayName}
              valueEn={form.nameEn}
              locale={locale}
              kind={form.type === 'company' ? 'company' : 'person'}
              onChange={(patch) =>
                setForm((current) => ({
                  ...current,
                  ...(patch.nameAr !== undefined ? { displayName: patch.nameAr } : {}),
                  ...(patch.nameEn !== undefined ? { nameEn: patch.nameEn } : {}),
                }))
              }
            />
            <label className="field">
              <span>{ar ? 'النوع' : 'Type'}</span>
              <select
                value={form.type}
                onChange={(event) => set('type', event.target.value as FormState['type'])}
              >
                <option value="person">{ar ? 'فرد' : 'Person'}</option>
                <option value="company">{ar ? 'شركة' : 'Company'}</option>
              </select>
            </label>
            <label className="field">
              <span>{ar ? 'الهاتف' : 'Phone'}</span>
              <input
                type="tel"
                dir="ltr"
                maxLength={40}
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
            </label>
            <label className="field">
              <span>{ar ? 'البريد' : 'Email'}</span>
              <input
                type="email"
                dir="ltr"
                maxLength={320}
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
            </label>
            <label className="field">
              <span>{ar ? 'الحالة' : 'Status'}</span>
              <select
                value={form.status}
                onChange={(event) => set('status', event.target.value as FormState['status'])}
              >
                <option value="active">{ar ? 'نشط' : 'Active'}</option>
                <option value="inactive">{ar ? 'غير نشط' : 'Inactive'}</option>
                <option value="archived">{ar ? 'مؤرشف' : 'Archived'}</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>{ar ? 'الأدوار' : 'Roles'}</legend>
            <div className="contact-edit__roles">
              {CONTACT_ROLE_KEYS.map((role) => (
                <label key={role} className="contact-edit__role">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(role)}
                    onChange={(event) =>
                      set(
                        'roles',
                        event.target.checked
                          ? [...form.roles, role]
                          : form.roles.filter((item) => item !== role),
                      )
                    }
                  />
                  {contactRoleLabel(role, ar)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{ar ? 'العنوان' : 'Address'}</legend>
            {(
              [
                ['governorate', ar ? 'المحافظة' : 'Governorate', 120],
                ['wilayat', ar ? 'الولاية' : 'Wilayat', 120],
                ['city', ar ? 'المدينة / المنطقة' : 'City', 120],
                ['area', ar ? 'الحي' : 'Area', 120],
                ['street', ar ? 'الشارع' : 'Street', 160],
                ['buildingNumber', ar ? 'رقم المبنى' : 'Building no.', 50],
                ['postalCode', ar ? 'الرمز البريدي' : 'Postal code', 24],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="field">
                <span>{label}</span>
                <input
                  maxLength={max}
                  value={form[key]}
                  onChange={(event) => set(key, event.target.value)}
                />
              </label>
            ))}
          </fieldset>
          <label className="field contact-edit__notes">
            <span>{ar ? 'ملاحظات داخلية' : 'Internal notes'}</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </label>
          <div className="contact-edit__actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? (ar ? 'جاري الحفظ…' : 'Saving…') : ar ? 'حفظ التعديلات' : 'Save changes'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="contact-stats" aria-label={ar ? 'الإحصائيات' : 'Statistics'}>
        <article className="contact-stat contact-stat--in">
          <span>{ar ? 'المبالغ المستلمة منه' : 'Received from them'}</span>
          <strong>{money(totals.received, locale)}</strong>
          <small>
            {ar ? 'إقامات وعرابين وفواتير مدفوعة' : 'Stays, deposits and paid invoices'}
          </small>
        </article>
        <article className="contact-stat contact-stat--out">
          <span>{ar ? 'المبالغ المدفوعة له' : 'Paid to them'}</span>
          <strong>{money(totals.paid, locale)}</strong>
          <small>
            {ar ? 'تأمينات مستردة ومصروفات مورّد' : 'Refunded deposits and supplier expenses'}
          </small>
        </article>
        <article className="contact-stat contact-stat--due">
          <span>{ar ? 'المستحق عليه' : 'Owed by them'}</span>
          <strong>{money(totals.outstanding, locale)}</strong>
          <small>{ar ? 'فواتير غير مسددة' : 'Unpaid invoices'}</small>
        </article>
        {isOwner ? (
          <>
            <article className="contact-stat contact-stat--in">
              <span>{ar ? 'إيرادات عقاراته' : 'Income on their properties'}</span>
              <strong>{money(totals.propertyIncome, locale)}</strong>
              <small>{ar ? 'إقامات وعرابين وإيجارات محصّلة' : 'Stays, deposits and rent'}</small>
            </article>
            <article className="contact-stat contact-stat--out">
              <span>{ar ? 'مصروفات عقاراته' : 'Expenses on their properties'}</span>
              <strong>{money(totals.propertyExpenses, locale)}</strong>
              <small>{ar ? 'المعتمدة والمدفوعة' : 'Approved and paid'}</small>
            </article>
          </>
        ) : null}
        <article className="contact-stat">
          <span>{ar ? 'العقارات والإيجارات' : 'Properties & leases'}</span>
          <strong>
            {isOwner
              ? ar
                ? `يملك ${detail.owned.length} ${arPlural(detail.owned.length, 'عقار', 'عقارات')}`
                : `Owns ${detail.owned.length}`
              : ar
                ? `${liveLeases.length} إيجار ساري`
                : `${liveLeases.length} active`}
          </strong>
          <small>
            {isOwner && liveLeases.length
              ? ar
                ? `ويستأجر ${liveLeases.length}`
                : `and rents ${liveLeases.length}`
              : ar
                ? `${detail.contracts.length} ${arPlural(detail.contracts.length, 'عقد', 'عقود')}`
                : `${detail.contracts.length} contracts`}
          </small>
        </article>
        <article className="contact-stat">
          <span>{ar ? 'الصيانة' : 'Maintenance'}</span>
          <strong>
            {openMaintenance.length} {ar ? 'مفتوح' : 'open'}
          </strong>
          <small>
            {ar ? `من ${detail.maintenance.length} طلب` : `of ${detail.maintenance.length} tickets`}
          </small>
        </article>
        <article className={openLegal.length ? 'contact-stat contact-stat--alert' : 'contact-stat'}>
          <span>{ar ? 'القضايا' : 'Legal cases'}</span>
          <strong>
            {openLegal.length} {ar ? 'مفتوحة' : 'open'}
          </strong>
          <small>{ar ? `من ${detail.legal.length} قضية` : `of ${detail.legal.length} cases`}</small>
        </article>
      </section>

      {totals.lines.length ? (
        <details className="contact-breakdown">
          <summary>{ar ? 'تفصيل المبالغ' : 'Money breakdown'}</summary>
          <ul>
            {totals.lines.map((line) => (
              <li key={`${line.key}:${line.currency}`}>
                <span>
                  {ar ? MONEY_LINE_LABELS[line.key].ar : MONEY_LINE_LABELS[line.key].en}
                  <small>
                    {' '}
                    ({line.count} {ar ? 'عملية' : 'records'})
                  </small>
                </span>
                <strong>{formatMoney(line.minor, line.currency, locale)}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sections.length ? (
        <nav className="contact-nav" aria-label={ar ? 'أقسام الطرف' : 'Party sections'}>
          {sections.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {ar ? item.ar : item.en} <b>{item.count}</b>
            </a>
          ))}
        </nav>
      ) : (
        <p className="contact-empty">
          {ar
            ? 'لا يرتبط هذا الطرف بعد بعقارات أو عقود أو حجوزات أو صيانة أو قضايا.'
            : 'This party is not yet linked to properties, contracts, bookings, maintenance or cases.'}
        </p>
      )}

      {detail.owned.length ? (
        <Section
          id="owned"
          title={ar ? 'المباني والعقارات التي يملكها' : 'Properties owned'}
          count={detail.owned.length}
        >
          <ul className="contact-grid">
            {detail.owned.map((row) => (
              <li key={row.propertyId}>
                <Link
                  className="contact-tile"
                  href={`/${portal}/properties/${encodeURIComponent(row.propertyId)}`}
                >
                  <strong>{ar ? row.nameAr : row.nameEn || row.nameAr}</strong>
                  <span>
                    {ar
                      ? `${row.units} ${arPlural(row.units, 'وحدة', 'وحدات')} · ${row.leased} مؤجّرة`
                      : `${row.units} units · ${row.leased} leased`}
                  </span>
                  {row.shareBasisPoints !== null && row.shareBasisPoints < 10000 ? (
                    <span>
                      {ar ? 'حصة الملكية' : 'Ownership share'}:{' '}
                      {(row.shareBasisPoints / 100).toFixed(2)}%
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.leases.length ? (
        <Section
          id="leases"
          title={ar ? 'ما يستأجره' : 'Rented units'}
          count={detail.leases.length}
        >
          <ul className="contact-rows">
            {detail.leases.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <Place row={row} ar={ar} />
                  </strong>
                  <span>
                    {formatDay(row.startsOn, ar)} — {formatDay(row.endsOn, ar)} ·{' '}
                    {formatMoney(row.rentMinor, row.currency, locale)}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {statusLabel(row.status, ar)}
                </span>
                {row.contractId ? (
                  <Link
                    className="button button--secondary button--small"
                    href={`/${portal}/contracts/${encodeURIComponent(row.contractId)}`}
                  >
                    {ar ? 'العقد' : 'Contract'}
                  </Link>
                ) : row.propertyId ? (
                  <Link
                    className="button button--secondary button--small"
                    href={`/${portal}/properties/${encodeURIComponent(row.propertyId)}`}
                  >
                    {ar ? 'العقار' : 'Property'}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.contracts.length ? (
        <Section id="contracts" title={ar ? 'العقود' : 'Contracts'} count={detail.contracts.length}>
          <ul className="contact-rows">
            {detail.contracts.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <bdi className="contact-code">{row.reference || '—'}</bdi> ·{' '}
                    {row.contractType === 'sale'
                      ? ar
                        ? 'عقد بيع'
                        : 'Sale'
                      : ar
                        ? 'عقد إيجار'
                        : 'Lease'}
                  </strong>
                  <span>
                    <Place row={row} ar={ar} /> ·{' '}
                    {row.side === 'owner'
                      ? ar
                        ? 'بصفته المالك'
                        : 'as owner'
                      : ar
                        ? 'بصفته المستأجر / المشتري'
                        : 'as tenant / buyer'}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {statusLabel(row.status, ar)}
                </span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/contracts/${encodeURIComponent(row.id)}`}
                >
                  {ar ? 'فتح' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.reservations.length ? (
        <Section
          id="reservations"
          title={ar ? 'حجوزات الإيجار والشراء' : 'Rent & purchase bookings'}
          count={detail.reservations.length}
        >
          <ul className="contact-rows">
            {detail.reservations.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <bdi className="contact-code">{row.reference || '—'}</bdi> ·{' '}
                    {row.mode === 'sale'
                      ? ar
                        ? 'حجز شراء'
                        : 'Purchase'
                      : ar
                        ? 'حجز إيجار'
                        : 'Rent'}
                  </strong>
                  <span>
                    <Place row={row} ar={ar} />
                    {row.depositMinor
                      ? ` · ${ar ? 'العربون' : 'Deposit'} ${formatMoney(row.depositMinor, row.currency || 'OMR', locale)}${row.paidAt ? (ar ? ' (مدفوع)' : ' (paid)') : ''}`
                      : ''}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {statusLabel(row.status, ar)}
                </span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/bookings/${encodeURIComponent(row.id)}`}
                >
                  {ar ? 'فتح' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.stays.length ? (
        <Section
          id="stays"
          title={ar ? 'الإقامات اليومية' : 'Daily stays'}
          count={detail.stays.length}
        >
          <ul className="contact-rows">
            {detail.stays.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <bdi className="contact-code">{row.reference}</bdi> ·{' '}
                    <Place row={row} ar={ar} />
                  </strong>
                  <span>
                    {formatDay(row.checkInOn, ar)} — {formatDay(row.checkOutOn, ar)} ·{' '}
                    {formatMoney(row.totalMinor, row.currency, locale)}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {statusLabel(row.status, ar)}
                </span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/stays/bookings/${encodeURIComponent(row.id)}`}
                >
                  {ar ? 'فتح' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.maintenance.length ? (
        <Section
          id="maintenance"
          title={ar ? 'الصيانة' : 'Maintenance'}
          count={detail.maintenance.length}
        >
          <ul className="contact-rows">
            {detail.maintenance.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <span>
                    <Place row={row} ar={ar} /> · {formatDay(row.createdAt, ar)}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {statusLabel(row.status, ar)}
                </span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/maintenance`}
                >
                  {ar ? 'الصيانة' : 'Maintenance'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.tasks.length ? (
        <Section id="tasks" title={ar ? 'المهام' : 'Tasks'} count={detail.tasks.length}>
          <ul className="contact-rows">
            {detail.tasks.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <bdi className="contact-code">{row.reference}</bdi> · {row.title}
                  </strong>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>{row.status}</span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/tasks/${encodeURIComponent(row.id)}`}
                >
                  {ar ? 'فتح' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.legal.length ? (
        <Section id="legal" title={ar ? 'القضايا' : 'Legal cases'} count={detail.legal.length}>
          <ul className="contact-rows">
            {detail.legal.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    <bdi className="contact-code">{row.reference}</bdi> · {row.title}
                  </strong>
                  <span>
                    {row.side === 'lawyer'
                      ? ar
                        ? 'محامي القضية'
                        : 'Lawyer'
                      : ar
                        ? 'الخصم'
                        : 'Counterparty'}
                    {' · '}
                    {ar ? 'المطالبة' : 'Claim'} {formatMoney(row.claimMinor, row.currency, locale)}
                    {' · '}
                    {ar ? 'المحصّل' : 'Recovered'}{' '}
                    {formatMoney(row.recoveredMinor, row.currency, locale)}
                    {row.nextHearingAt
                      ? ` · ${ar ? 'الجلسة' : 'Hearing'} ${formatDay(row.nextHearingAt, ar)}`
                      : ''}
                  </span>
                </div>
                <span className={`contact-status contact-status--${row.status}`}>
                  {LEGAL_STAGE_LABELS[row.status as LegalStage]
                    ? ar
                      ? LEGAL_STAGE_LABELS[row.status as LegalStage].ar
                      : LEGAL_STAGE_LABELS[row.status as LegalStage].en
                    : row.status}
                </span>
                <Link
                  className="button button--secondary button--small"
                  href={`/${portal}/legal/${encodeURIComponent(row.id)}`}
                >
                  {ar ? 'فتح' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
