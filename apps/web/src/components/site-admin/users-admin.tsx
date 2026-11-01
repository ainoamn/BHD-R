'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type { AdminUser } from '@/lib/site-admin-shared';
import { SUBSCRIPTION_LABELS } from '@/lib/site-admin-shared';
import { roleLabel } from '@/lib/team-shared';
import { adminDate, adminErrorText, adminGet, type AdminNotice } from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

function countryLabel(user: AdminUser, ar: boolean) {
  if (ar) return user.countryNameAr || user.countryCode || '—';
  return user.countryNameEn || user.countryCode || '—';
}

function planLabel(user: AdminUser, ar: boolean) {
  if (!user.planKey) return ar ? 'بلا باقة' : 'No plan';
  return (ar ? user.planNameAr : user.planNameEn) || user.planKey;
}

/** Every BHD R account: search, country/plan, open full dossier, suspend or restore. */
export function UsersAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const title = ar ? 'المستخدمون' : 'Users';
  const lead = ar
    ? 'كل حسابات BHD R مع الدولة والباقة وتاريخ انتهائها. اضغط الاسم لفتح الملف الكامل: العقارات والعقود والتقييمات والجلسات والمساحة المستخدمة.'
    : 'Every BHD R account with country, plan, and expiry. Open a name for the full dossier: properties, contracts, reviews, sessions, and storage.';

  const load = useCallback((q: string) => {
    let live = true;
    setFailed(false);
    adminGet<{ users: AdminUser[] }>(`/api/site-admin/users?q=${encodeURIComponent(q)}`)
      .then((data) => live && setUsers(data.users))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(submitted), [load, submitted]);

  async function setSuspended(user: AdminUser, suspended: boolean) {
    const name = user.displayName || user.email || '';
    if (
      suspended &&
      !window.confirm(
        ar
          ? `إيقاف حساب «${name}»؟ سيُسجَّل خروجه من كل الأجهزة فوراً ولن يستطيع الدخول حتى تعيد تفعيله. بياناته تبقى كما هي.`
          : `Suspend “${name}”? They are signed out everywhere at once and cannot sign in until restored. Their records stay intact.`,
      )
    ) {
      return;
    }
    setBusyId(user.id);
    try {
      const data = await browserNextMutation<{ user: { id: string; disabledAt: string | null } }>(
        `/api/site-admin/users/${encodeURIComponent(user.id)}`,
        { method: 'PATCH', body: JSON.stringify({ suspended }) },
      );
      setUsers((list) =>
        list
          ? list.map((row) =>
              row.id === user.id ? { ...row, disabledAt: data.user.disabledAt } : row,
            )
          : list,
      );
      setNotice({
        tone: 'success',
        text: suspended
          ? ar
            ? `أُوقف حساب «${name}».`
            : `Suspended “${name}”.`
          : ar
            ? `أُعيد تفعيل حساب «${name}».`
            : `Restored “${name}”.`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر التنفيذ.', 'Could not complete.'),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SiteAdminPage locale={locale} title={title} lead={lead}>
      <SiteAdminSurface>
        <form
          className="sa-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <input
            className="sa-input"
            type="search"
            value={query}
            placeholder={ar ? 'بحث بالاسم أو البريد' : 'Search by name or email'}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="button button--quiet">
            {ar ? 'بحث' : 'Search'}
          </button>
        </form>
      </SiteAdminSurface>

      <SiteAdminBanner notice={notice} />

      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل المستخدمين."
          messageEn="Could not load users."
        />
      ) : users === null ? (
        <SiteAdminLoading locale={locale} />
      ) : users.length ? (
        <SiteAdminSurface title={ar ? 'النتائج' : 'Results'}>
          <div className="sa-table-wrap">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>{ar ? 'الحساب' : 'Account'}</th>
                  <th>{ar ? 'الدولة' : 'Country'}</th>
                  <th>{ar ? 'الباقة' : 'Plan'}</th>
                  <th>{ar ? 'انتهاء الاشتراك' : 'Expires'}</th>
                  <th>{ar ? 'المنشآت' : 'Organizations'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th aria-label={ar ? 'إجراء' : 'Action'} />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const sub = user.subscriptionStatus
                    ? SUBSCRIPTION_LABELS[user.subscriptionStatus]
                    : null;
                  return (
                    <tr key={user.id} className={user.disabledAt ? 'is-off' : undefined}>
                      <td>
                        <Link
                          className="sa-user-link"
                          href={`/${locale}/admin/users/${encodeURIComponent(user.id)}`}
                        >
                          <strong>{user.displayName || '—'}</strong>
                        </Link>
                        {user.isSiteAdmin ? (
                          <span className="pmh-badge pmh-badge--info sa-tag">
                            {ar ? 'إدارة' : 'Admin'}
                          </span>
                        ) : null}
                        <small>
                          <bdi dir="ltr">{user.email ?? '—'}</bdi>
                        </small>
                      </td>
                      <td>
                        <span>{countryLabel(user, ar)}</span>
                        {user.countryCode ? (
                          <small>
                            <bdi dir="ltr">{user.countryCode}</bdi>
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <strong>{planLabel(user, ar)}</strong>
                        {sub ? (
                          <small>
                            <span className={`pmh-badge pmh-badge--${sub.tone}`}>
                              {ar ? sub.ar : sub.en}
                            </span>
                          </small>
                        ) : null}
                      </td>
                      <td>{adminDate(user.subscriptionEndsOn, ar)}</td>
                      <td>
                        {user.organizations.length ? (
                          <ul className="sa-orgs">
                            {user.organizations.map((org, index) => (
                              <li key={`${org.nameAr}-${index}`}>
                                <bdi>{org.nameAr}</bdi> · {roleLabel(org.role, ar)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted">{ar ? 'بلا منشأة' : 'No organization'}</span>
                        )}
                      </td>
                      <td>
                        {user.disabledAt ? (
                          <span className="pmh-badge pmh-badge--danger">
                            {ar ? 'موقوف' : 'Suspended'}
                          </span>
                        ) : (
                          <span className="pmh-badge pmh-badge--ready">
                            {ar ? 'نشط' : 'Active'}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          disabled={busyId === user.id}
                          onClick={() => void setSuspended(user, !user.disabledAt)}
                        >
                          {user.disabledAt
                            ? ar
                              ? 'إعادة التفعيل'
                              : 'Restore'
                            : ar
                              ? 'إيقاف'
                              : 'Suspend'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SiteAdminSurface>
      ) : (
        <SiteAdminSurface>
          <p className="muted" style={{ margin: 0 }}>
            {ar ? 'لا نتائج.' : 'No results.'}
          </p>
        </SiteAdminSurface>
      )}
    </SiteAdminPage>
  );
}
