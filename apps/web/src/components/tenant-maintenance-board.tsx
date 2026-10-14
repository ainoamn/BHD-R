'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { OwnerTenantRequests } from '@/components/owner-tenant-requests';
import { OPEN_TENANT_REQUEST, type OwnerTenantRequest } from '@/lib/tenant-requests-shared';

type Loaded = { requests: OwnerTenantRequest[]; allowed: boolean; canRecordPayments: boolean };

/**
 * Maintenance requests tenants send from their accounts, on the maintenance page itself: the team
 * approves, documents the work with photos or video, and closes each one with proof.
 */
export function TenantMaintenanceBoard({
  locale,
  active,
}: {
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/owner/tenant-requests?type=maintenance', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as Loaded);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const asked = new URLSearchParams(window.location.search).get('focus');
    setFocus(asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null);
    void load();
  }, [active, load]);

  if (data && !data.allowed) return null;
  const open = data?.requests.filter((item) => OPEN_TENANT_REQUEST.has(item.status)).length ?? 0;

  return (
    <section className="tenant-maintenance-board" aria-labelledby="tenant-maintenance-title">
      <header className="tenant-maintenance-board__head">
        <div>
          <h2 id="tenant-maintenance-title">
            {ar ? '🛠️ طلبات الصيانة من المستأجرين' : '🛠️ Maintenance requests from tenants'}
            {data ? <span className="tenant-maintenance-board__count">{open}</span> : null}
          </h2>
          <p className="muted">
            {ar
              ? 'تصل هنا فور إرسالها من حساب المستأجر بصورها وفيديوهاتها. وافق عليها، وثّق العمل، ولا يُغلق البلاغ إلا بصورة بعد الإصلاح وسيلفي لمن أنجزه.'
              : 'They arrive here the moment a tenant sends them, with photos and videos. Approve, document the work, and close each one only with an after photo and a selfie of whoever fixed it.'}
          </p>
        </div>
        <Link className="button button--quiet button--tiny" href="/owner/tenant-requests" prefetch>
          {ar ? 'كل طلبات المستأجرين' : 'All tenant requests'}
        </Link>
      </header>
      {failed ? (
        <p className="tenant-notice" role="status">
          {ar ? 'تعذّر تحميل طلبات المستأجرين الآن.' : 'Could not load tenant requests right now.'}{' '}
          <button type="button" className="file-link-button" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : !data ? (
        <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : (
        <OwnerTenantRequests
          requests={data.requests}
          locale={locale}
          focus={focus}
          canRecordPayments={data.canRecordPayments}
          onChanged={() => void load()}
          showReports={false}
        />
      )}
    </section>
  );
}
