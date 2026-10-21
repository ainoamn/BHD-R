'use client';

import { useEffect, useState } from 'react';
import type { PlatformDiagnostics } from '@/lib/platform-admin-neon';

const TONE: Record<string, string> = {
  ok: 'ready',
  warn: 'warn',
  fail: 'danger',
  info: 'info',
};

/** Live system diagnostics for platform administrators. */
export function PlatformDiagnosticsPanel({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [data, setData] = useState<PlatformDiagnostics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/platform/diagnostics', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('fail');
        const payload = (await response.json()) as PlatformDiagnostics;
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
        {ar ? 'تعذّر تحميل التشخيص. تحقّق من صلاحياتك.' : 'Could not load diagnostics.'}
      </p>
    );
  }
  if (!data) {
    return <p className="muted">{ar ? 'جارٍ فحص النظام…' : 'Checking the system…'}</p>;
  }

  return (
    <div className="platform-admin-diagnostics">
      <header className="platform-admin__head">
        <div>
          <h1>{ar ? 'تشخيص النظام' : 'System diagnostics'}</h1>
          <p>
            {ar
              ? 'فحص البنية التحتية والهوية والطوابير والجلسات — حدّث الصفحة لإعادة الفحص.'
              : 'Infrastructure, identity, queues, and sessions — refresh to re-run.'}
          </p>
        </div>
        <time className="muted" dateTime={data.generatedAt} dir="ltr">
          {new Date(data.generatedAt).toLocaleString(ar ? 'ar-OM' : 'en-GB')}
        </time>
      </header>

      <div className="platform-admin__cards">
        {(
          [
            [ar ? 'المنشآت' : 'Orgs', data.counts.organizations],
            [ar ? 'المستخدمون' : 'Users', data.counts.users],
            [ar ? 'جلسات نشطة' : 'Sessions', data.counts.activeSessions],
            [ar ? 'عقارات' : 'Properties', data.counts.properties],
            [ar ? 'outbox' : 'Outbox', data.counts.openOutbox],
            [ar ? 'تدقيق 24س' : 'Audit 24h', data.counts.auditLast24h],
          ] as Array<[string, number]>
        ).map(([label, value]) => (
          <article key={label} className="platform-admin__card">
            <span>{label}</span>
            <strong dir="ltr">{value}</strong>
          </article>
        ))}
      </div>

      <ul className="platform-admin-checks">
        {data.checks.map((check) => (
          <li key={check.id} className={`platform-admin-checks__item is-${TONE[check.status]}`}>
            <div>
              <strong>{ar ? check.labelAr : check.labelEn}</strong>
              <p>{ar ? check.detailAr : check.detailEn}</p>
            </div>
            <span className={`pmh-badge pmh-badge--${TONE[check.status]}`}>
              {check.status === 'ok'
                ? ar
                  ? 'سليم'
                  : 'OK'
                : check.status === 'warn'
                  ? ar
                    ? 'تنبيه'
                    : 'Warn'
                  : check.status === 'fail'
                    ? ar
                      ? 'عطل'
                      : 'Fail'
                    : ar
                      ? 'معلومة'
                      : 'Info'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
