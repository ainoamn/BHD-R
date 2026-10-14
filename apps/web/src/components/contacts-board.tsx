'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { arPlural, contactRoleLabel, type ContactSummary } from '@/lib/contacts-shared';
import type { PortalRole } from '@/lib/types';

type Filter = 'all' | 'owner' | 'tenant' | 'supplier' | 'lawyer' | 'other';

const FILTERS: { key: Filter; ar: string; en: string }[] = [
  { key: 'all', ar: 'الكل', en: 'All' },
  { key: 'owner', ar: 'الملاك', en: 'Owners' },
  { key: 'tenant', ar: 'المستأجرون', en: 'Tenants' },
  { key: 'supplier', ar: 'المورّدون', en: 'Suppliers' },
  { key: 'lawyer', ar: 'المحامون', en: 'Lawyers' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
];

function isOwner(contact: ContactSummary) {
  return contact.properties > 0 || contact.roles.includes('owner');
}

function isTenant(contact: ContactSummary) {
  return contact.activeLeases > 0 || contact.roles.includes('tenant');
}

function matches(contact: ContactSummary, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'owner':
      return isOwner(contact);
    case 'tenant':
      return isTenant(contact);
    case 'supplier':
      return contact.roles.includes('supplier');
    case 'lawyer':
      return contact.roles.includes('lawyer');
    default:
      return (
        !isOwner(contact) &&
        !isTenant(contact) &&
        !contact.roles.includes('supplier') &&
        !contact.roles.includes('lawyer')
      );
  }
}

/** The address book: every party with their roles and links, each opening its own page. */
export function ContactsBoard({
  portal,
  locale,
  active,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const [contacts, setContacts] = useState<ContactSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/contacts', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      setContacts(((await response.json()) as { contacts: ContactSummary[] }).contacts);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      if (!detail || detail.section === 'contacts') void load();
    };
    window.addEventListener('bhd-r-ops-refresh', onRefresh);
    return () => window.removeEventListener('bhd-r-ops-refresh', onRefresh);
  }, [active, load]);

  const needle = query.trim().toLowerCase();
  const shown = (contacts ?? []).filter(
    (contact) =>
      matches(contact, filter) &&
      (!needle ||
        [contact.displayName, contact.email, contact.phone]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle))),
  );

  return (
    <section className="contacts-board" aria-label={ar ? 'دفتر العناوين' : 'Address book'}>
      <div className="contacts-board__tools">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ar ? 'ابحث بالاسم أو الهاتف أو البريد' : 'Search name, phone or email'}
          aria-label={ar ? 'بحث في الأطراف' : 'Search parties'}
        />
        <div className="contacts-board__filters" role="group">
          {FILTERS.map((item) => {
            const count = (contacts ?? []).filter((contact) => matches(contact, item.key)).length;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={filter === item.key}
                className={filter === item.key ? 'is-active' : undefined}
                onClick={() => setFilter(item.key)}
              >
                {ar ? item.ar : item.en} <b>{count}</b>
              </button>
            );
          })}
        </div>
      </div>

      {!contacts ? (
        <p className="contacts-board__empty" role={failed ? 'alert' : 'status'}>
          {failed
            ? ar
              ? 'تعذّر تحميل الأطراف. حاول مجدداً بعد قليل.'
              : 'Could not load parties. Try again shortly.'
            : ar
              ? 'جاري التحميل…'
              : 'Loading…'}
        </p>
      ) : shown.length ? (
        <ul className="contacts-board__list">
          {shown.map((contact) => (
            <li key={contact.id}>
              <Link
                className="contact-card"
                href={`/${portal}/contacts/${encodeURIComponent(contact.id)}`}
              >
                <span className="contact-card__avatar" aria-hidden="true">
                  {contact.displayName.trim().charAt(0).toUpperCase() || '؟'}
                </span>
                <span className="contact-card__body">
                  <strong>{contact.displayName}</strong>
                  <span className="contact-card__roles">
                    {contact.properties > 0 && !contact.roles.includes('owner') ? (
                      <span className="contact-role contact-role--owner">
                        {contactRoleLabel('owner', ar)}
                      </span>
                    ) : null}
                    {contact.roles.map((role) => (
                      <span key={role} className={`contact-role contact-role--${role}`}>
                        {contactRoleLabel(role, ar)}
                      </span>
                    ))}
                    {contact.member ? (
                      <span className="contact-role contact-role--member">
                        {ar ? 'عضو بالفريق' : 'Team member'}
                      </span>
                    ) : null}
                    {contact.status !== 'active' ? (
                      <span className="contact-role contact-role--muted">
                        {contact.status === 'archived'
                          ? ar
                            ? 'مؤرشف'
                            : 'Archived'
                          : ar
                            ? 'غير نشط'
                            : 'Inactive'}
                      </span>
                    ) : null}
                  </span>
                  <span className="contact-card__meta">
                    {[contact.phone, contact.email].filter(Boolean).join(' · ') ||
                      (ar ? 'لا توجد بيانات تواصل' : 'No contact details')}
                  </span>
                  <span className="contact-card__links">
                    {contact.properties ? (
                      <span>
                        {ar
                          ? `يملك ${contact.properties} ${arPlural(contact.properties, 'عقار', 'عقارات')}`
                          : `Owns ${contact.properties} propert${contact.properties === 1 ? 'y' : 'ies'}`}
                      </span>
                    ) : null}
                    {contact.activeLeases ? (
                      <span>
                        {ar
                          ? `${contact.activeLeases} إيجار ساري`
                          : `${contact.activeLeases} active lease${contact.activeLeases === 1 ? '' : 's'}`}
                      </span>
                    ) : null}
                    {contact.contracts ? (
                      <span>
                        {ar
                          ? `${contact.contracts} ${arPlural(contact.contracts, 'عقد', 'عقود')}`
                          : `${contact.contracts} contracts`}
                      </span>
                    ) : null}
                    {contact.openLegal ? (
                      <span className="contact-card__alert">
                        {ar
                          ? `${contact.openLegal} قضية مفتوحة`
                          : `${contact.openLegal} open case${contact.openLegal === 1 ? '' : 's'}`}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="contact-card__open" aria-hidden="true">
                  {ar ? 'عرض وتعديل' : 'View & edit'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="contacts-board__empty">
          {needle || filter !== 'all'
            ? ar
              ? 'لا توجد نتائج مطابقة.'
              : 'No matching parties.'
            : ar
              ? 'لا يوجد أطراف بعد. أضف طرفاً من زر «إضافة طرف».'
              : 'No parties yet. Add one with “Add party”.'}
        </p>
      )}
    </section>
  );
}
