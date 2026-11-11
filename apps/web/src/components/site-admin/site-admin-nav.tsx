'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { pushSoftPortalUrl, useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { siteAdminSoftSectionFromPath } from '@/lib/site-admin-soft-nav';
import {
  SITE_CONSOLE_NAV_GROUPS,
  siteConsoleSectionsFor,
  type SiteAdminAccess,
  type SiteConsoleNavGroup,
} from '@/lib/site-admin-shared';
import type { Viewer } from '@/lib/types';
import { identityMe } from '@/lib/identity/client';
import { readActiveAu } from '@/lib/identity/window-session';

const BhdAppSwitcher = dynamic(
  () => import('@/components/bhd-app-switcher').then((mod) => mod.BhdAppSwitcher),
  { ssr: false },
);

const GROUP_ORDER = Object.entries(SITE_CONSOLE_NAV_GROUPS)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([id]) => id as SiteConsoleNavGroup);

function withActiveAu(href: string, pathname: string): string {
  if (typeof window === 'undefined') return href;
  const fromPath = pathname.includes('?')
    ? new URL(pathname, window.location.origin).searchParams.get('au')
    : null;
  const au = fromPath || new URLSearchParams(window.location.search).get('au');
  if (!au) return href;
  const url = new URL(href, window.location.origin);
  if (!url.searchParams.has('au')) url.searchParams.set('au', au);
  return `${url.pathname}${url.search}`;
}

/** Vertical sidebar — soft-switches sections without remounting the shell. */
export function SiteAdminNav({
  access,
  locale,
  viewer,
}: {
  access: SiteAdminAccess;
  locale: 'ar' | 'en';
  viewer: Viewer;
}) {
  const ar = locale === 'ar';
  const pathname = useSoftPortalPathname() || `/${locale}/admin`;
  const current = siteAdminSoftSectionFromPath(pathname) ?? 'overview';
  const sections = siteConsoleSectionsFor(access);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: SITE_CONSOLE_NAV_GROUPS[group],
    items: sections.filter((section) => section.group === group),
  })).filter((entry) => entry.items.length > 0);
  // SSR footer can lag the shared cookie; prefer this tab's ?au= identity face.
  const [tabFace, setTabFace] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    let live = true;
    const au = readActiveAu();
    void identityMe()
      .then((payload) => {
        if (!live || !payload) return;
        const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        const match =
          (au && accounts.find((item) => item.id === au)) ||
          accounts.find((item) => item.id === payload.user?.id) ||
          null;
        const email =
          (typeof match?.email === 'string' && match.email.trim()) ||
          (typeof payload.user?.email === 'string' && payload.user.email.trim()) ||
          '';
        const name =
          (typeof match?.name === 'string' && match.name.trim()) ||
          (typeof payload.user?.name === 'string' && payload.user.name.trim()) ||
          email;
        if (email || name) setTabFace({ name: name || email, email });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pathname]);
  const accountLabel = useMemo(() => {
    const name = (tabFace?.name || viewer.displayName)?.trim();
    const email = (tabFace?.email || viewer.email)?.trim();
    if (name && email && name.toLowerCase() !== email.toLowerCase()) {
      return { primary: name, secondary: email };
    }
    return { primary: name || email || (ar ? 'الحساب' : 'Account'), secondary: null };
  }, [tabFace, viewer.displayName, viewer.email, ar]);

  return (
    <aside
      className="site-admin-nav"
      aria-label={ar ? 'تحكم الموقع والنظام' : 'Site & system control'}
    >
      <div className="site-admin-nav__brand">
        <div className="site-admin-nav__mark" aria-hidden="true" />
        <div className="site-admin-nav__brand-copy">
          <p className="site-admin-nav__product">BHD R</p>
          <p className="site-admin-nav__title">{ar ? 'تحكم الموقع' : 'Site control'}</p>
        </div>
        <span className="site-admin-nav__role">
          {access.root
            ? ar
              ? 'مالك الموقع'
              : 'Site owner'
            : ar
              ? 'مدير مفوَّض'
              : 'Delegated manager'}
        </span>
      </div>

      <nav className="site-admin-nav__list">
        {groups.map(({ group, label, items }) => (
          <div key={group} className="site-admin-nav__group">
            {group !== 'home' ? (
              <p className="site-admin-nav__group-label">{ar ? label.ar : label.en}</p>
            ) : null}
            {items.map((section) => {
              const href = `/${locale}${section.path}`;
              const active = section.id === current;
              return (
                <Link
                  key={section.id}
                  href={href}
                  prefetch={false}
                  data-no-progress=""
                  className={active ? 'is-current' : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => {
                    if (
                      !event.defaultPrevented &&
                      event.button === 0 &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey &&
                      (!event.currentTarget.target || event.currentTarget.target === '_self')
                    ) {
                      event.preventDefault();
                      pushSoftPortalUrl(
                        withActiveAu(event.currentTarget.href, pathname),
                      );
                    }
                  }}
                >
                  {ar ? section.ar : section.en}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="site-admin-nav__account">
        <div className="site-admin-nav__account-copy">
          <p className="site-admin-nav__account-name">{accountLabel.primary}</p>
          {accountLabel.secondary ? (
            <p className="site-admin-nav__account-email">{accountLabel.secondary}</p>
          ) : null}
        </div>
        <div className="site-admin-nav__account-switcher">
          <BhdAppSwitcher viewer={viewer} locale={locale} />
        </div>
      </div>
    </aside>
  );
}
