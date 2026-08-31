'use client';

import { useEffect, useState } from 'react';
import type { PortalRole } from '@/lib/types';
import type { OperationsSection, OperationsWorkspacePayload } from '@/lib/portal-ops-types';
import {
  emptyOpsPayload,
  fetchOpsPayload,
  getOpsCache,
  isOpsCacheFresh,
} from '@/lib/portal-ops-client-cache';
import { OperationsConsole } from './operations-console';

function resolvePayload(
  portal: PortalRole,
  section: OperationsSection,
  locale: 'ar' | 'en',
): OperationsWorkspacePayload {
  return getOpsCache(portal, section) ?? emptyOpsPayload(locale);
}

/**
 * Soft-nav ops pane: always paints immediately from memory (or empty shell).
 * Never unmounts to a white boot screen when the section prop changes.
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
  const [payload, setPayload] = useState<OperationsWorkspacePayload>(() =>
    resolvePayload(portal, section, locale),
  );
  const [shownSection, setShownSection] = useState(section);

  // Apply cache synchronously when the section changes (before paint).
  if (section !== shownSection) {
    setShownSection(section);
    setPayload(resolvePayload(portal, section, locale));
  }

  useEffect(() => {
    let cancelled = false;

    const hit = getOpsCache(portal, section);
    if (hit) {
      setPayload(hit);
      if (!isOpsCacheFresh(portal, section)) {
        void fetchOpsPayload(portal, section).then((fresh) => {
          if (!cancelled && fresh) setPayload(fresh);
        });
      }
    } else {
      void fetchOpsPayload(portal, section).then((fresh) => {
        if (cancelled) return;
        setPayload(fresh ?? emptyOpsPayload(locale));
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
  }, [portal, section, locale]);

  return (
    <div className="portal-ops-pane" data-section={section}>
      <OperationsConsole
        portal={portal}
        section={section}
        locale={payload.locale || locale}
        records={payload.records}
        summary={payload.summary}
        secondary={payload.secondary}
        context={payload.context}
        apiOnline={payload.apiOnline}
        nestConfigured={payload.nestConfigured}
        recordsEmpty={payload.recordsEmpty}
        apiUnauthorized={payload.apiUnauthorized}
        dataFromDb={payload.dataFromDb}
      />
    </div>
  );
}
