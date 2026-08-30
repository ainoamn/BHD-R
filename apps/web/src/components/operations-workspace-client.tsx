'use client';

import { useEffect, useState } from 'react';
import { BrandMark } from '@bhd-r/ui';
import type { PortalRole } from '@/lib/types';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
import { fetchOpsPayload, getOpsCache } from '@/lib/portal-ops-client-cache';
import { OperationsConsole, type OperationsContext } from './operations-console';

/**
 * Client ops workspace: paint from in-memory cache when available so sidebar
 * navigation feels like returning to an already-open view (WAZEN-style).
 */
export function OperationsWorkspaceClient({
  portal,
  section,
  locale,
}: {
  portal: PortalRole;
  section: OperationsSection;
  locale: 'ar' | 'en';
}) {
  const [payload, setPayload] = useState<OperationsWorkspacePayload | null>(() =>
    getOpsCache(portal, section),
  );

  useEffect(() => {
    let cancelled = false;

    const hit = getOpsCache(portal, section);
    if (hit) {
      setPayload(hit);
      void fetchOpsPayload(portal, section).then((fresh) => {
        if (!cancelled && fresh) setPayload(fresh);
      });
    } else {
      setPayload(null);
      void fetchOpsPayload(portal, section).then((fresh) => {
        if (!cancelled && fresh) setPayload(fresh);
      });
    }

    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ portal: PortalRole; section: OperationsSection }>)
        .detail;
      if (!detail || detail.portal !== portal || detail.section !== section) return;
      void fetchOpsPayload(portal, section).then((fresh) => {
        if (!cancelled && fresh) setPayload(fresh);
      });
    };
    window.addEventListener('bhd-r-ops-refresh', onRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener('bhd-r-ops-refresh', onRefresh);
    };
  }, [portal, section]);

  if (!payload) {
    return (
      <div className="portal-ops-boot" aria-busy="true" aria-live="polite">
        <BrandMark />
        <p>{locale === 'ar' ? 'جاري تحميل القسم…' : 'Loading section…'}</p>
      </div>
    );
  }

  return (
    <OperationsConsole
      portal={portal}
      section={section}
      locale={payload.locale || locale}
      records={payload.records}
      summary={payload.summary}
      secondary={payload.secondary}
      context={payload.context as OperationsContext}
      apiOnline={payload.apiOnline}
      nestConfigured={payload.nestConfigured}
      recordsEmpty={payload.recordsEmpty}
      apiUnauthorized={payload.apiUnauthorized}
      dataFromDb={payload.dataFromDb}
    />
  );
}
