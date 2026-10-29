'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlatformSecurityView } from '@/lib/platform-admin-neon';

type Tab = 'threats' | 'geo' | 'attempts' | 'quarantine' | 'locks' | 'audit';

/** Audit explorer, geo/IP visibility, quarantine, locks, and heuristic threat scan. */
export function PlatformSecurityPanel({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PlatformSecurityView | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('threats');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quarantineIp, setQuarantineIp] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/site-admin/security', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('fail');
      const payload = (await response.json()) as PlatformSecurityView;
      setData(payload);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function postAction(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const csrf = document.cookie
        .split('; ')
        .find((row) => row.startsWith('bhd_r_csrf='))
        ?.split('=')[1];
      const response = await fetch('/api/site-admin/security', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('fail');
      setMessage(ar ? 'تم تنفيذ الإجراء.' : 'Action applied.');
      await load();
    } catch {
      setMessage(ar ? 'تعذّر تنفيذ الإجراء.' : 'Could not apply the action.');
    } finally {
      setBusy(false);
    }
  }

  const filteredAttempts = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.attempts;
    return data.attempts.filter(
      (row) =>
        row.ipAddress?.toLowerCase().includes(q) ||
        row.ipHash.toLowerCase().includes(q) ||
        row.countryCode?.toLowerCase().includes(q) ||
        row.outcome.includes(q) ||
        row.reason?.toLowerCase().includes(q) ||
        row.userId?.toLowerCase().includes(q),
    );
  }, [data, query]);

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.liveSessions;
    return data.liveSessions.filter(
      (row) =>
        row.email.toLowerCase().includes(q) ||
        row.displayName.toLowerCase().includes(q) ||
        row.countryCode?.toLowerCase().includes(q) ||
        row.ipHash?.toLowerCase().includes(q) ||
        row.userId.toLowerCase().includes(q),
    );
  }, [data, query]);

  if (failed) {
    return (
      <p className="platform-admin__error">
        {ar ? 'تعذّر تحميل سجل الأمن.' : 'Could not load the security console.'}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="muted">{ar ? 'جارٍ تحميل الإشارات الأمنية…' : 'Loading security signals…'}</p>
    );
  }

  const tabs: Array<{ id: Tab; ar: string; en: string }> = [
    { id: 'threats', ar: 'التهديدات والفحص', en: 'Threats & scan' },
    { id: 'geo', ar: 'الجلسات والدول', en: 'Sessions & countries' },
    { id: 'attempts', ar: 'محاولات الدخول', en: 'Login attempts' },
    { id: 'quarantine', ar: 'حجر IP', en: 'IP quarantine' },
    { id: 'locks', ar: 'الحسابات المقفلة', en: 'Locked accounts' },
    { id: 'audit', ar: 'التدقيق', en: 'Audit' },
  ];

  return (
    <div className="platform-admin-security">
      <header className="platform-admin__head">
        <div>
          <h1>{ar ? 'الأمن والتدقيق' : 'Security & audit'}</h1>
          <p>{ar ? data.noteAr : data.noteEn}</p>
        </div>
        <button
          type="button"
          className="platform-admin__ghost-btn"
          disabled={busy}
          onClick={() => void load()}
        >
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </header>

      <div className="platform-admin__cards">
        <article className="platform-admin__card">
          <span>{ar ? 'جلسات نشطة' : 'Active sessions'}</span>
          <strong dir="ltr">{data.sessions.active}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'إلغاءات 7 أيام' : 'Revoked (7d)'}</span>
          <strong dir="ltr">{data.sessions.revokedLast7d}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'حجر IP نشط' : 'IP quarantines'}</span>
          <strong dir="ltr">{data.quarantines.length}</strong>
        </article>
        <article className="platform-admin__card">
          <span>{ar ? 'حسابات مقفلة' : 'Locked accounts'}</span>
          <strong dir="ltr">{data.locks.length}</strong>
        </article>
      </div>

      <div className="platform-admin-security__tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'is-active' : undefined}
            onClick={() => setTab(item.id)}
          >
            {ar ? item.ar : item.en}
          </button>
        ))}
      </div>

      <label className="platform-admin-security__search">
        <span className="sr-only">{ar ? 'بحث' : 'Search'}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            ar ? 'بحث في IP / الدولة / البريد / بصمة…' : 'Search IP / country / email / hash…'
          }
          dir="ltr"
        />
      </label>

      {message ? <p className="platform-admin-security__msg">{message}</p> : null}

      {tab === 'threats' ? (
        <section className="platform-admin__panel">
          <h2>{ar ? 'فحص التهديدات (قواعد + إشارات)' : 'Threat scan (rules + signals)'}</h2>
          <p className="muted">
            {ar
              ? `العتبات: ${data.thresholds.ipFailCount} فشلاً من IP → حجر ${data.thresholds.ipQuarantineHours} ساعة؛ ${data.thresholds.accountFailCount} فشلاً على حساب → قفل واستعادة.`
              : `Thresholds: ${data.thresholds.ipFailCount} IP failures → ${data.thresholds.ipQuarantineHours}h quarantine; ${data.thresholds.accountFailCount} account failures → lock + recovery.`}
          </p>
          <ul className="platform-admin-security__threats">
            {data.threats.map((finding) => (
              <li key={finding.id} data-severity={finding.severity}>
                <strong>{ar ? finding.titleAr : finding.titleEn}</strong>
                <span>{ar ? finding.detailAr : finding.detailEn}</span>
                <code dir="ltr">{finding.code}</code>
              </li>
            ))}
          </ul>
          <p className="muted">
            {ar ? 'الإجراءات موثّقة في: ' : 'Procedures documented in: '}
            <code dir="ltr">docs/security/ANTI-FRAUD-AND-INTRUSION-AR.md</code>
          </p>
        </section>
      ) : null}

      {tab === 'geo' ? (
        <>
          <section className="platform-admin__panel">
            <h2>{ar ? 'حسب الدولة' : 'By country'}</h2>
            <div className="platform-admin-table-wrap">
              <table className="platform-admin-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الدولة' : 'Country'}</th>
                    <th>{ar ? 'جلسات' : 'Sessions'}</th>
                    <th>{ar ? 'مستخدمون' : 'Users'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((row) => (
                    <tr key={row.countryCode}>
                      <td dir="ltr">{row.countryCode}</td>
                      <td dir="ltr">{row.sessions}</td>
                      <td dir="ltr">{row.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="platform-admin__panel">
            <h2>{ar ? 'جلسات نشطة (حساب + دولة)' : 'Live sessions (account + country)'}</h2>
            <div className="platform-admin-table-wrap">
              <table className="platform-admin-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الحساب' : 'Account'}</th>
                    <th>{ar ? 'الدولة' : 'Country'}</th>
                    <th>{ar ? 'بصمة IP' : 'IP hash'}</th>
                    <th>{ar ? 'بدأت' : 'Started'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((row) => (
                    <tr key={row.sessionId}>
                      <td>
                        <div>{row.displayName}</div>
                        <code dir="ltr">{row.email}</code>
                      </td>
                      <td dir="ltr">{row.countryCode ?? '—'}</td>
                      <td dir="ltr">{row.ipHash ? `${row.ipHash.slice(0, 12)}…` : '—'}</td>
                      <td dir="ltr">
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleString(
                              ar ? 'ar-OM-u-nu-latn' : 'en-GB',
                              {
                                dateStyle: 'short',
                                timeStyle: 'short',
                                timeZone: 'Asia/Muscat',
                              },
                            )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === 'attempts' ? (
        <section className="platform-admin__panel">
          <h2>{ar ? 'محاولات الدخول (IP خام للأمن)' : 'Login attempts (raw IP for ops)'}</h2>
          <div className="platform-admin-table-wrap">
            <table className="platform-admin-table">
              <thead>
                <tr>
                  <th>{ar ? 'الوقت' : 'When'}</th>
                  <th>{ar ? 'النتيجة' : 'Outcome'}</th>
                  <th>IP</th>
                  <th>{ar ? 'الدولة' : 'Country'}</th>
                  <th>{ar ? 'السبب' : 'Reason'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttempts.map((row) => (
                  <tr key={row.id}>
                    <td dir="ltr">
                      {new Date(row.at).toLocaleString(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Asia/Muscat',
                      })}
                    </td>
                    <td dir="ltr">{row.outcome}</td>
                    <td dir="ltr">{row.ipAddress ?? `${row.ipHash.slice(0, 12)}…`}</td>
                    <td dir="ltr">{row.countryCode ?? '—'}</td>
                    <td dir="ltr">{row.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'quarantine' ? (
        <section className="platform-admin__panel">
          <h2>{ar ? 'حجر عناوين IP' : 'IP quarantine'}</h2>
          <form
            className="platform-admin-security__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!quarantineIp.trim()) return;
              void postAction({
                action: 'quarantine_ip',
                ipAddress: quarantineIp.trim(),
                reason: 'manual_admin_quarantine',
              });
              setQuarantineIp('');
            }}
          >
            <input
              type="text"
              value={quarantineIp}
              onChange={(event) => setQuarantineIp(event.target.value)}
              placeholder={ar ? 'عنوان IP للحجر' : 'IP address to quarantine'}
              dir="ltr"
              required
            />
            <button type="submit" disabled={busy}>
              {ar ? 'حجر الآن' : 'Quarantine'}
            </button>
          </form>
          <div className="platform-admin-table-wrap">
            <table className="platform-admin-table">
              <thead>
                <tr>
                  <th>IP</th>
                  <th>{ar ? 'الدولة' : 'Country'}</th>
                  <th>{ar ? 'السبب' : 'Reason'}</th>
                  <th>{ar ? 'حتى' : 'Until'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.quarantines.map((row) => (
                  <tr key={row.id}>
                    <td dir="ltr">{row.ipAddress ?? `${row.ipHash.slice(0, 12)}…`}</td>
                    <td dir="ltr">{row.countryCode ?? '—'}</td>
                    <td>{row.reason}</td>
                    <td dir="ltr">
                      {new Date(row.untilAt).toLocaleString(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Asia/Muscat',
                      })}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void postAction({ action: 'release_quarantine', quarantineId: row.id })
                        }
                      >
                        {ar ? 'إطلاق' : 'Release'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'locks' ? (
        <section className="platform-admin__panel">
          <h2>{ar ? 'حسابات مقفلة أمنياً' : 'Security-locked accounts'}</h2>
          <p className="muted">
            {ar
              ? 'المالك يستعيد عبر /security-unlock (هوية + OTP بريد؛ واتساب لاحقاً).'
              : 'Owners recover via /security-unlock (identity + email OTP; WhatsApp later).'}
          </p>
          <div className="platform-admin-table-wrap">
            <table className="platform-admin-table">
              <thead>
                <tr>
                  <th>{ar ? 'الحساب' : 'Account'}</th>
                  <th>{ar ? 'السبب' : 'Reason'}</th>
                  <th>{ar ? 'منذ' : 'Since'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.locks.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.displayName}</div>
                      <code dir="ltr">{row.email}</code>
                    </td>
                    <td>{row.reason}</td>
                    <td dir="ltr">
                      {new Date(row.lockedAt).toLocaleString(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Asia/Muscat',
                      })}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void postAction({
                            action: 'unlock_user',
                            userId: row.userId,
                            lockId: row.id,
                          })
                        }
                      >
                        {ar ? 'فتح يدوي' : 'Unlock'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'audit' ? (
        <>
          <section className="platform-admin__panel">
            <h2>{ar ? 'أكثر الإجراءات (7 أيام)' : 'Top actions (7 days)'}</h2>
            <ul className="platform-admin-status-list">
              {data.topActions.map((row) => (
                <li key={row.action}>
                  <code dir="ltr">{row.action}</code>
                  <strong dir="ltr">{row.count}</strong>
                </li>
              ))}
            </ul>
          </section>
          <section className="platform-admin__panel">
            <h2>{ar ? 'آخر أحداث التدقيق' : 'Latest audit events'}</h2>
            <div className="platform-admin-table-wrap">
              <table className="platform-admin-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الوقت' : 'When'}</th>
                    <th>{ar ? 'الإجراء' : 'Action'}</th>
                    <th>{ar ? 'المورد' : 'Resource'}</th>
                    <th>{ar ? 'بصمة IP' : 'IP hash'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit
                    .filter((row) => {
                      const q = query.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        row.action.toLowerCase().includes(q) ||
                        row.resourceType.toLowerCase().includes(q) ||
                        (row.ipHash?.toLowerCase().includes(q) ?? false)
                      );
                    })
                    .map((row) => (
                      <tr key={row.id}>
                        <td dir="ltr">
                          {new Date(row.at).toLocaleString(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: 'Asia/Muscat',
                          })}
                        </td>
                        <td>
                          <code dir="ltr">{row.action}</code>
                        </td>
                        <td dir="ltr">
                          {row.resourceType}
                          {row.resourceId ? ` · ${row.resourceId.slice(0, 8)}` : ''}
                        </td>
                        <td dir="ltr">{row.ipHash ? `${row.ipHash.slice(0, 12)}…` : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
