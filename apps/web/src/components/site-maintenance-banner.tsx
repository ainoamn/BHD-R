'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';

type PublicControl = {
  maintenance: {
    enabled: boolean;
    mode: 'banner' | 'hard';
    messageAr: string;
    messageEn: string;
  };
  pages: Record<string, boolean>;
};

const SKIP =
  /^\/(admin|site-admin|platform|owner|developer|tenant|login|forgot-password|reset-password|activate)(\/|$)/;

/** Top-of-site notice when maintenance is enabled (hidden inside consoles). */
export function SiteMaintenanceBanner() {
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (SKIP.test(pathname)) {
      setMessage(null);
      return;
    }
    let cancelled = false;
    fetch('/api/site/public-control', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as PublicControl;
      })
      .then((payload) => {
        if (cancelled || !payload?.maintenance?.enabled) {
          if (!cancelled) setMessage(null);
          return;
        }
        setMessage(
          locale === 'ar' ? payload.maintenance.messageAr : payload.maintenance.messageEn,
        );
      })
      .catch(() => {
        if (!cancelled) setMessage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, locale]);

  if (!message) return null;

  return (
    <div className="site-maintenance-banner" role="status">
      <p>{message}</p>
    </div>
  );
}
