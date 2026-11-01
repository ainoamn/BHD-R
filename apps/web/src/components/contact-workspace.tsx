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

function blank(value: string | null | undefined): boolean {
  return !value || !value.trim();
}

function Fact({
  label,
  children,
  missing,
  missingLabel,
}: {
  label: string;
  children: ReactNode;
  missing?: boolean;
  missingLabel?: string;
}) {
  return (
    <div className={`contact-fact${missing ? ' is-missing' : ''}`}>
      <dt>
        {label}
        {missing ? (
          <span className="contact-fact__mark" title={missingLabel || label}>
            !
          </span>
        ) : null}
      </dt>
      <dd>
        {missing && (children === '—' || children == null || children === '') ? (
          <span className="contact-fact__empty">{missingLabel || '—'}</span>
        ) : (
          (children ?? '—')
        )}
      </dd>
    </div>
  );
}

type ProfileGap = { key: string; label: string; group: 'party' | 'identity' };

function Sheet({
  title,
  eyebrow,
  children,
  tone = 'plain',
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  tone?: 'plain' | 'identity';
}) {
  return (
    <section className={`contact-sheet contact-sheet--${tone}`}>
      <header className="contact-sheet__head">
        {eyebrow ? <p className="contact-sheet__eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </header>
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

  const identity = party.identity;
  const englishName = party.nameEn || identity?.nameEn || null;
  const missingText = ar ? 'ناقص' : 'Missing';

  const gaps: ProfileGap[] = [];
  const pushGap = (key: string, labelAr: string, labelEn: string, group: ProfileGap['group']) => {
    gaps.push({ key, label: ar ? labelAr : labelEn, group });
  };
  if (blank(englishName)) pushGap('nameEn', 'الاسم بالإنجليزية', 'English name', 'party');
  if (blank(party.phone)) pushGap('phone', 'الهاتف', 'Phone', 'party');
  if (blank(party.email)) pushGap('email', 'البريد', 'Email', 'party');
  if (blank(party.address?.governorate))
    pushGap('governorate', 'المحافظة', 'Governorate', 'party');
  if (blank(party.address?.wilayat)) pushGap('wilayat', 'الولاية', 'Wilayat', 'party');
  if (blank(party.address?.city)) pushGap('city', 'المدينة', 'City', 'party');

  if (!identity) {
    pushGap('identity', 'بيانات حساب Identity', 'Identity account profile', 'identity');
  } else if (identity.accountKind === 'company') {
    if (blank(identity.companyNameAr))
      pushGap('companyNameAr', 'اسم الشركة بالعربية', 'Company name (AR)', 'identity');
    if (blank(identity.companyNameEn))
      pushGap('companyNameEn', 'اسم الشركة بالإنجليزية', 'Company name (EN)', 'identity');
    if (blank(identity.nameAr))
      pushGap('idNameAr', 'اسم المفوض بالعربية', 'Authorized name (AR)', 'identity');
    if (blank(identity.nameEn))
      pushGap('idNameEn', 'اسم المفوض بالإنجليزية', 'Authorized name (EN)', 'identity');
    if (blank(identity.crNumber))
      pushGap('crNumber', 'السجل التجاري', 'Commercial register no.', 'identity');
    if (blank(identity.phone)) pushGap('idPhone', 'هاتف Identity', 'Identity phone', 'identity');
    if (!identity.files.commercialRegisterFile)
      pushGap('crFile', 'مرفق السجل التجاري', 'Commercial register file', 'identity');
    if (!identity.files.authorizationFile)
      pushGap('authFile', 'مرفق التفويض', 'Authorization file', 'identity');
  } else {
    if (blank(identity.nameAr))
      pushGap('idNameAr', 'الاسم بالعربية (Identity)', 'Identity name (AR)', 'identity');
    if (blank(identity.nameEn))
      pushGap('idNameEn', 'الاسم بالإنجليزية (Identity)', 'Identity name (EN)', 'identity');
    if (blank(identity.phone)) pushGap('idPhone', 'هاتف Identity', 'Identity phone', 'identity');
    if (blank(identity.nationality))
      pushGap('nationality', 'الجنسية', 'Nationality', 'identity');
    if (blank(identity.gender)) pushGap('gender', 'الجنس', 'Gender', 'identity');
    if (blank(identity.birthDate))
      pushGap('birthDate', 'تاريخ الميلاد', 'Birth date', 'identity');
  }

  const gapKeys = new Set(gaps.map((item) => item.key));
  const formGaps = {
    nameEn: blank(form.nameEn),
    phone: blank(form.phone),
    email: blank(form.email),
    governorate: blank(form.governorate),
    wilayat: blank(form.wilayat),
    city: blank(form.city),
  };

  return (
    <div className="contact-page">
      <Link className="contact-page__back" href={`/${portal}/contacts`}>
        {ar ? '→ الأطراف ودفتر العناوين' : '← Parties & address book'}
      </Link>

      <header className="contact-hero">
        <div className="contact-hero__glow" aria-hidden="true" />
        <div className="contact-hero__top">
          {party.mark?.avatarUrl ? (
            <IdentityAvatar
              name={party.displayName}
              mark={party.mark}
              locale={locale}
              size={88}
              className="contact-hero__avatar"
            />
          ) : (
            <span className="contact-hero__avatar" aria-hidden="true">
              {party.displayName.trim().charAt(0).toUpperCase() || '؟'}
            </span>
          )}
          <div className="contact-hero__main">
            <p className="contact-hero__eyebrow">
              {ar ? 'ملف الطرف · دفتر العناوين' : 'Party dossier · address book'}
            </p>
            <h1 className="name-with-mark">
              {party.displayName}
              <VerifiedMark verified={party.mark?.verified} locale={locale} size={22} />
            </h1>
            {englishName ? <p className="contact-hero__en">{englishName}</p> : null}
            {gaps.length ? (
              <p className="contact-hero__gaps" role="status">
                {ar
                  ? `${gaps.length} ${gaps.length === 1 ? 'نقص' : 'نواقص'} في الملف`
                  : `${gaps.length} missing ${gaps.length === 1 ? 'field' : 'fields'}`}
              </p>
            ) : null}
            {party.mark ? (
              <p className={`contact-hero__verify${party.mark.verified ? ' is-verified' : ''}`}>
                {party.mark.verified
                  ? ar
                    ? 'موثّق لدى بن حمود'
                    : 'Verified by Bin Hamood'
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
            <BadgeChips badges={party.badges} locale={locale} labelled size={22} max={5} />
          </div>
          <div className="contact-hero__actions">
            {whatsapp ? (
              <a
                className="contact-hero__btn contact-hero__btn--ghost"
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
                className="contact-hero__btn contact-hero__btn--solid"
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
        </div>
        <ul className="contact-channels">
          <li className={blank(party.phone) ? 'is-missing' : undefined}>
            <span>{ar ? 'الهاتف' : 'Phone'}</span>
            {party.phone ? (
              <bdi>
                <a href={`tel:${party.phone}`}>{party.phone}</a>
              </bdi>
            ) : (
              <em className="contact-channels__gap">{missingText}</em>
            )}
          </li>
          <li className={blank(party.email) ? 'is-missing' : undefined}>
            <span>{ar ? 'البريد' : 'Email'}</span>
            {party.email ? (
              <bdi>
                <a href={`mailto:${party.email}`}>{party.email}</a>
              </bdi>
            ) : (
              <em className="contact-channels__gap">{missingText}</em>
            )}
          </li>
          <li
            className={
              blank(party.address?.governorate) ||
              blank(party.address?.wilayat) ||
              blank(party.address?.city)
                ? 'is-missing'
                : undefined
            }
          >
            <span>{ar ? 'العنوان' : 'Address'}</span>
            <em className={!addressLine ? 'contact-channels__gap' : undefined}>
              {addressLine || missingText}
            </em>
          </li>
          <li>
            <span>{ar ? 'أُضيف في' : 'Added'}</span>
            <em>{formatDay(party.createdAt, ar)}</em>
          </li>
        </ul>
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

      {gaps.length ? (
        <div className="contact-gaps" role="alert">
          <strong>
            {ar
              ? `${gaps.length} نواقص في ملف الطرف — الحقول المعلّمة بالأحمر تحتاج تعبئة:`
              : `${gaps.length} gaps in this profile — red fields need completing:`}
          </strong>
          <ul>
            {gaps.map((item) => (
              <li key={item.key}>
                <span className={`contact-gaps__tag contact-gaps__tag--${item.group}`}>
                  {item.group === 'identity' ? 'Identity' : ar ? 'دفتر العناوين' : 'Address book'}
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <form className="contact-edit" onSubmit={(event) => void save(event)}>
          <header className="contact-edit__banner">
            <p>{ar ? 'تعديل ملف الطرف' : 'Edit party profile'}</p>
            <h2>{ar ? 'حدّث البيانات الظاهرة في دفتر العناوين' : 'Update what appears in the address book'}</h2>
          </header>
          <fieldset>
            <legend>{ar ? 'البيانات الأساسية' : 'Basics'}</legend>
            <div className={formGaps.nameEn ? 'is-missing-wrap' : undefined}>
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
            </div>
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
            <label className={`field${formGaps.phone ? ' is-missing' : ''}`}>
              <span>
                {ar ? 'الهاتف' : 'Phone'}
                {formGaps.phone ? <i className="contact-field-mark">!</i> : null}
              </span>
              <input
                type="tel"
                dir="ltr"
                maxLength={40}
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
            </label>
            <label className={`field${formGaps.email ? ' is-missing' : ''}`}>
              <span>
                {ar ? 'البريد' : 'Email'}
                {formGaps.email ? <i className="contact-field-mark">!</i> : null}
              </span>
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
            ).map(([key, label, max]) => {
              const required =
                key === 'governorate' || key === 'wilayat' || key === 'city'
                  ? formGaps[key]
                  : false;
              return (
                <label key={key} className={`field${required ? ' is-missing' : ''}`}>
                  <span>
                    {label}
                    {required ? <i className="contact-field-mark">!</i> : null}
                  </span>
                  <input
                    maxLength={max}
                    value={form[key]}
                    onChange={(event) => set(key, event.target.value)}
                  />
                </label>
              );
            })}
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
      ) : (
        <div className="contact-sheets">
          <Sheet
            tone="plain"
            eyebrow={ar ? 'دفتر العناوين' : 'Address book'}
            title={ar ? 'بيانات الطرف' : 'Party details'}
          >
            <dl className="contact-facts">
              <Fact label={ar ? 'الاسم بالعربية' : 'Name (AR)'}>{party.displayName}</Fact>
              <Fact
                label={ar ? 'الاسم بالإنجليزية' : 'Name (EN)'}
                missing={gapKeys.has('nameEn')}
                missingLabel={missingText}
              >
                {englishName || '—'}
              </Fact>
              <Fact label={ar ? 'النوع' : 'Type'}>
                {party.type === 'company' ? (ar ? 'شركة' : 'Company') : ar ? 'فرد' : 'Person'}
              </Fact>
              <Fact label={ar ? 'الحالة' : 'Status'}>{statusLabel(party.status, ar)}</Fact>
              <Fact
                label={ar ? 'الهاتف' : 'Phone'}
                missing={gapKeys.has('phone')}
                missingLabel={missingText}
              >
                {party.phone ? (
                  <bdi dir="ltr">
                    <a href={`tel:${party.phone}`}>{party.phone}</a>
                  </bdi>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact
                label={ar ? 'البريد' : 'Email'}
                missing={gapKeys.has('email')}
                missingLabel={missingText}
              >
                {party.email ? (
                  <bdi dir="ltr">
                    <a href={`mailto:${party.email}`}>{party.email}</a>
                  </bdi>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label={ar ? 'الأدوار' : 'Roles'}>
                {party.roles.length
                  ? party.roles.map((role) => contactRoleLabel(role, ar)).join(' · ')
                  : '—'}
              </Fact>
              <Fact label={ar ? 'المصدر' : 'Source'}>{party.source || '—'}</Fact>
            </dl>
            <div className="contact-sheet__block">
              <h3>{ar ? 'العنوان المحلي' : 'Local address'}</h3>
              <dl className="contact-facts contact-facts--tight">
                <Fact
                  label={ar ? 'المحافظة' : 'Governorate'}
                  missing={gapKeys.has('governorate')}
                  missingLabel={missingText}
                >
                  {party.address?.governorate || '—'}
                </Fact>
                <Fact
                  label={ar ? 'الولاية' : 'Wilayat'}
                  missing={gapKeys.has('wilayat')}
                  missingLabel={missingText}
                >
                  {party.address?.wilayat || '—'}
                </Fact>
                <Fact
                  label={ar ? 'المدينة' : 'City'}
                  missing={gapKeys.has('city')}
                  missingLabel={missingText}
                >
                  {party.address?.city || '—'}
                </Fact>
                <Fact label={ar ? 'الحي' : 'Area'}>{party.address?.area || '—'}</Fact>
                <Fact label={ar ? 'الشارع' : 'Street'}>{party.address?.street || '—'}</Fact>
                <Fact label={ar ? 'رقم المبنى' : 'Building'}>
                  {party.address?.buildingNumber || '—'}
                </Fact>
                <Fact label={ar ? 'الرمز البريدي' : 'Postal code'}>
                  {party.address?.postalCode || '—'}
                </Fact>
              </dl>
            </div>
            {party.notes ? (
              <div className="contact-sheet__notes">
                <h3>{ar ? 'ملاحظات داخلية' : 'Internal notes'}</h3>
                <p>{party.notes}</p>
              </div>
            ) : null}
          </Sheet>

          {identity ? (
            <Sheet
              tone="identity"
              eyebrow="BHD Identity"
              title={ar ? 'بيانات الحساب الرسمية' : 'Official account profile'}
            >
              <p className="contact-sheet__lead">
                {ar
                  ? 'تُحفظ تلقائياً من بيانات العقد عند الحجز أو الشراء أو الاستئجار، أو من حساب Identity عند توفره.'
                  : 'Saved automatically from contract details on booking, purchase, or rent — or from the Identity account when available.'}
              </p>
              <dl className="contact-facts">
                <Fact
                  label={ar ? 'الاسم بالعربي' : 'Name (AR)'}
                  missing={gapKeys.has('idNameAr')}
                  missingLabel={missingText}
                >
                  {identity.nameAr || '—'}
                </Fact>
                <Fact
                  label={ar ? 'الاسم بالإنجليزي' : 'Name (EN)'}
                  missing={gapKeys.has('idNameEn')}
                  missingLabel={missingText}
                >
                  {identity.nameEn || '—'}
                </Fact>
                <Fact
                  label={ar ? 'الهاتف' : 'Phone'}
                  missing={gapKeys.has('idPhone')}
                  missingLabel={missingText}
                >
                  <bdi dir="ltr">{identity.phone || '—'}</bdi>
                </Fact>
                <Fact label="WhatsApp">
                  <bdi dir="ltr">{identity.whatsapp || identity.phone2 || '—'}</bdi>
                </Fact>
                <Fact
                  label={ar ? 'الجنسية' : 'Nationality'}
                  missing={gapKeys.has('nationality')}
                  missingLabel={missingText}
                >
                  {identity.nationality || '—'}
                </Fact>
                <Fact
                  label={ar ? 'الجنس' : 'Gender'}
                  missing={gapKeys.has('gender')}
                  missingLabel={missingText}
                >
                  {identity.gender === 'male'
                    ? ar
                      ? 'ذكر'
                      : 'Male'
                    : identity.gender === 'female'
                      ? ar
                        ? 'أنثى'
                        : 'Female'
                      : identity.gender || '—'}
                </Fact>
                <Fact
                  label={ar ? 'تاريخ الميلاد' : 'Birth date'}
                  missing={gapKeys.has('birthDate')}
                  missingLabel={missingText}
                >
                  {identity.birthDate || '—'}
                </Fact>
                <Fact label={ar ? 'الرقم المدني' : 'Civil ID'}>
                  <bdi dir="ltr">{identity.civilId || '—'}</bdi>
                </Fact>
                <Fact label={ar ? 'انتهاء البطاقة' : 'Civil ID expiry'}>
                  {identity.civilIdExpires || '—'}
                </Fact>
                <Fact label={ar ? 'جواز السفر' : 'Passport'}>
                  <bdi dir="ltr">{identity.passportNumber || '—'}</bdi>
                </Fact>
                <Fact label={ar ? 'انتهاء الجواز' : 'Passport expiry'}>
                  {identity.passportExpires || '—'}
                </Fact>
                <Fact label={ar ? 'العنوان' : 'Address'}>{identity.address || '—'}</Fact>
                <Fact label={ar ? 'المدينة / الدولة' : 'City / country'}>
                  {[identity.city, identity.country].filter(Boolean).join(' · ') || '—'}
                </Fact>
                {identity.accountKind === 'company' ? (
                  <>
                    <Fact
                      label={ar ? 'الشركة' : 'Company'}
                      missing={gapKeys.has('companyNameAr') || gapKeys.has('companyNameEn')}
                      missingLabel={missingText}
                    >
                      {identity.companyNameAr || identity.companyNameEn || '—'}
                    </Fact>
                    <Fact
                      label={ar ? 'السجل التجاري' : 'CR'}
                      missing={gapKeys.has('crNumber')}
                      missingLabel={missingText}
                    >
                      <bdi dir="ltr">{identity.crNumber || '—'}</bdi>
                    </Fact>
                  </>
                ) : null}
              </dl>
              <ul className="contact-identity__files">
                {(
                  [
                    {
                      key: 'civil',
                      label: ar ? 'البطاقة الشخصية' : 'Civil ID',
                      file: identity.files.civilIdFile,
                      required: false,
                    },
                    {
                      key: 'passport',
                      label: ar ? 'جواز السفر' : 'Passport',
                      file: identity.files.passportFile,
                      required: false,
                    },
                    {
                      key: 'crFile',
                      label: ar ? 'السجل التجاري' : 'Commercial register',
                      file: identity.files.commercialRegisterFile,
                      required: gapKeys.has('crFile'),
                    },
                    {
                      key: 'authFile',
                      label: ar ? 'خطاب التفويض' : 'Authorization',
                      file: identity.files.authorizationFile,
                      required: gapKeys.has('authFile'),
                    },
                  ] as const
                ).map((row) => (
                  <li
                    key={row.key}
                    className={row.file ? 'is-ready' : row.required ? 'is-missing' : undefined}
                  >
                    <span>
                      {row.label}
                      {row.required && !row.file ? (
                        <i className="contact-field-mark">!</i>
                      ) : null}
                    </span>
                    <span>
                      {row.file?.filename ||
                        (row.required ? missingText : ar ? 'لا يوجد' : 'None')}
                    </span>
                  </li>
                ))}
              </ul>
            </Sheet>
          ) : (
            <Sheet
              tone="identity"
              eyebrow="BHD Identity"
              title={ar ? 'لا توجد بيانات هوية بعد' : 'No Identity profile yet'}
            >
              <p className="contact-sheet__lead contact-sheet__lead--warn">
                {ar
                  ? 'ملف Identity ناقص. عند حجز أو شراء أو استئجار من حساب مسجّل تظهر هنا البيانات الكاملة تلقائياً.'
                  : 'Identity profile is missing. When this party books, buys, or rents while signed in, their full profile appears here.'}
              </p>
            </Sheet>
          )}
        </div>
      )}

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
