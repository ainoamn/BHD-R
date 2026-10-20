'use client';

import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { isTenantSoftBasePath } from '@/lib/tenant-soft-nav';

function softTenantHref(href: string): boolean {
  try {
    const path = href.startsWith('http')
      ? new URL(href).pathname.replace(/^\/(ar|en)(?=\/|$)/, '')
      : href.replace(/^\/(ar|en)(?=\/|$)/, '');
    if (path === '/tenant' || path === '/tenant/') return true;
    if (!path.startsWith('/tenant/')) return false;
    const rest = path.slice('/tenant/'.length);
    if (rest.includes('/')) return false;
    return isTenantSoftBasePath(rest ? `/${rest}` : '');
  } catch {
    return false;
  }
}

/** Same soft pushState used by the portal sidebar — keeps TenantSpaceHost mounted. */
export function SoftPortalLink({
  href,
  soft = true,
  children,
  onClick,
  ...rest
}: ComponentProps<typeof Link> & { soft?: boolean; children: ReactNode }) {
  const enableSoft = soft && typeof href === 'string' && softTenantHref(href);
  return (
    <Link
      href={href}
      scroll={false}
      {...(enableSoft ? { 'data-no-progress': '' } : {})}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          enableSoft &&
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          (!event.currentTarget.target || event.currentTarget.target === '_self')
        ) {
          event.preventDefault();
          const url = new URL(event.currentTarget.href);
          if (url.pathname !== window.location.pathname || url.search !== window.location.search) {
            window.history.pushState(null, '', url.pathname + url.search + url.hash);
          }
        }
      }}
    >
      {children}
    </Link>
  );
}
