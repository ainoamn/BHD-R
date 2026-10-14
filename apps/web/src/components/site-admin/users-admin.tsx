'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type { AdminUser } from '@/lib/site-admin-shared';
import { roleLabel } from '@/lib/team-shared';
import { adminDate, adminErrorText, adminGet, type AdminNotice } from './admin-fetch';

/** Every BHD R account: search, see where each works, suspend or restore. */
export function UsersAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    <main className="site-admin site-admin--wide">
      <header className="site-admin__head">
        <div>
          <p className="site-admin__kicker">{ar ? 'إدارة الموقع' : 'Site administration'}</p>
          <h1>{ar ? 'المستخدمون' : 'Users'}</h1>
          <p className="muted">
            {ar
              ? 'كل حسابات BHD R ومنشآتها وأدوارها. الإيقاف يخرج الشخص من كل الأجهزة ويمنع دخوله دون حذف أي بيانات.'
              : 'Every BHD R account with its organizations and roles. Suspending signs the person out everywhere and blocks sign-in without deleting anything.'}
          </p>
        </div>
      </header>

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

      {notice ? (
        <p
          className={`notice notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

      {failed ? (
        <p className="notice notice--error" role="alert">
          {ar ? 'تعذّر تحميل المستخدمين.' : 'Could not load users.'}
        </p>
      ) : users === null ? (
        <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : users.length ? (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>{ar ? 'الحساب' : 'Account'}</th>
                <th>{ar ? 'المنشآت والأدوار' : 'Organizations & roles'}</th>
                <th>{ar ? 'منذ' : 'Since'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
                <th aria-label={ar ? 'إجراء' : 'Action'} />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.disabledAt ? 'is-off' : undefined}>
                  <td>
                    <strong>{user.displayName || '—'}</strong>
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
                  <td>{adminDate(user.createdAt, ar)}</td>
                  <td>
                    {user.disabledAt ? (
                      <span className="pmh-badge pmh-badge--danger">
                        {ar ? 'موقوف' : 'Suspended'}
                      </span>
                    ) : (
                      <span className="pmh-badge pmh-badge--ready">{ar ? 'نشط' : 'Active'}</span>
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
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{ar ? 'لا نتائج.' : 'No results.'}</p>
      )}
    </main>
  );
}
