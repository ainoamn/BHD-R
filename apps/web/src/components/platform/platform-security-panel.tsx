'use client';

import { useEffect, useState } from 'react';
import type { PlatformSecurityView } from '@/lib/platform-admin-neon';

/** Audit explorer and session signals for platform security oversight. */
export function PlatformSecurityPanel({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PlatformSecurityView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/platform/security', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('fail');
        const payload = (await response.json()) as PlatformSecurityView;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="platform-admin__error">
        {ar ? 'تعذّر تحميل سجل الأمن.' : 'Could not load the security console.'}
      </p>
    );
  }
  if (!data) {
    return <p className="muted">{ar ? 'جارٍ تحميل الإشارات الأمنية…' : 'Loading security signals…'}</p>;
  }

  return (
    <div className="platform-admin-security">
      <header className="platform-admin__head">
        <div>
          <h1>{ar ? 'الأمن والتدقيق' : 'Security & audit'}</h1>
          <p>{ar ? data.noteAr : data.noteEn}</p>
        </div>
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
      </div>

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
              {data.audit.map((row) => (
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
    </div>
  );
}
