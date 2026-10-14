'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { browserNextMutation } from '@/lib/api';
import { BHD_APPS, type BhdApp } from '@/lib/bhd/apps';
import { roleLabel, type OrganizationChoice } from '@/lib/team-shared';
import type { Viewer } from '@/lib/types';

type Panel = 'apps' | 'account' | null;

function isCurrentApp(app: BhdApp): boolean {
  return app.id === 'bhd-r' || app.clientId === 'bhd-r';
}

function hrefForApp(app: BhdApp, locale: 'ar' | 'en'): string {
  if (app.id === 'account') return 'https://id.bhd-om.com/account';
  if (isCurrentApp(app)) return `/${locale}`;
  if (app.mode === 'sso' && app.startUrl) return app.startUrl;
  return `${app.origin.replace(/\/$/, '')}/`;
}

/** Shown only when the account works in more than one organization (own + employer teams). */
function OrganizationSwitcher({ ar, locale }: { ar: boolean; locale: 'ar' | 'en' }) {
  const [choices, setChoices] = useState<OrganizationChoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/organization', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { organizations?: OrganizationChoice[] } | null) => {
        if (!cancelled && payload?.organizations) setChoices(payload.organizations);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (choices.length < 2) return null;

  const choose = async (organizationId: string) => {
    setBusy(organizationId);
    setFailed(false);
    try {
      await browserNextMutation('/api/auth/organization', {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      window.location.assign(`/${locale}/portal`);
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  return (
    <div className="bhd-switcher-orgs">
      <small>{ar ? 'المنشأة التي تعمل عليها' : 'Working in'}</small>
      {choices.map((choice) => (
        <button
          key={choice.organizationId}
          type="button"
          className={choice.current ? 'bhd-switcher-org is-current' : 'bhd-switcher-org'}
          aria-current={choice.current || undefined}
          disabled={choice.current || busy !== null}
          onClick={() => void choose(choice.organizationId)}
        >
          <span>{ar ? choice.nameAr : choice.nameEn}</span>
          <small>
            {busy === choice.organizationId
              ? ar
                ? 'جارٍ التبديل…'
                : 'Switching…'
              : roleLabel(choice.role, ar)}
          </small>
        </button>
      ))}
      {failed ? (
        <small className="bhd-switcher-orgs__error">
          {ar ? 'تعذر التبديل، أعد المحاولة.' : 'Could not switch; try again.'}
        </small>
      ) : null}
    </div>
  );
}

export function BhdAppSwitcher({ viewer, locale }: { viewer: Viewer; locale: 'ar' | 'en' }) {
  const [panel, setPanel] = useState<Panel>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const appsId = useId();
  const accountId = useId();
  const initial = viewer.displayName.trim().slice(0, 1) || 'B';
  const ar = locale === 'ar';
  const apps = BHD_APPS.filter((app) => app.enabled);

  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [panel]);

  return (
    <div className="bhd-switcher-slot" ref={rootRef}>
      <button
        type="button"
        className="bhd-switcher-grid"
        aria-label={ar ? 'تطبيقات BHD' : 'BHD apps'}
        aria-haspopup="dialog"
        aria-expanded={panel === 'apps'}
        aria-controls={panel === 'apps' ? appsId : undefined}
        onClick={() => setPanel((current) => (current === 'apps' ? null : 'apps'))}
      >
        <span aria-hidden="true">
          {Array.from({ length: 9 }).map((_, index) => (
            <i key={index} />
          ))}
        </span>
      </button>
      <button
        type="button"
        className="bhd-switcher-avatar"
        aria-label={ar ? 'الحساب' : 'Account'}
        aria-haspopup="dialog"
        aria-expanded={panel === 'account'}
        aria-controls={panel === 'account' ? accountId : undefined}
        onClick={() => setPanel((current) => (current === 'account' ? null : 'account'))}
      >
        <span>{initial}</span>
      </button>

      {panel === 'apps' ? (
        <div
          className="bhd-switcher-card"
          id={appsId}
          role="dialog"
          aria-label={ar ? 'تطبيقات BHD' : 'BHD apps'}
        >
          <div className="bhd-switcher-card__head">
            <strong>{ar ? 'تطبيقات BHD' : 'BHD apps'}</strong>
            <small>{ar ? 'حساب واحد · منتجات مستقلة' : 'One account · independent products'}</small>
          </div>
          <div className="bhd-switcher-apps">
            {apps.map((app) => {
              const current = isCurrentApp(app);
              return (
                <a
                  key={app.id}
                  className={current ? 'bhd-switcher-app is-current' : 'bhd-switcher-app'}
                  href={hrefForApp(app, locale)}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setPanel(null)}
                >
                  <span
                    className="bhd-app-mark"
                    style={{ background: app.soft, color: app.accent }}
                  >
                    {app.mark}
                  </span>
                  <span>{ar ? app.nameAr : app.nameEn}</span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel === 'account' ? (
        <div
          className="bhd-switcher-card bhd-switcher-account"
          id={accountId}
          role="dialog"
          aria-label={ar ? 'الحساب' : 'Account'}
        >
          <div className="bhd-switcher-account__user">
            <span className="bhd-switcher-account__initial">{initial}</span>
            <div>
              <strong>{viewer.displayName}</strong>
              <small>{viewer.email ?? viewer.username ?? (ar ? 'حساب BHD' : 'BHD account')}</small>
            </div>
          </div>
          <OrganizationSwitcher ar={ar} locale={locale} />
          <Link href={`/${locale}/portal`} onClick={() => setPanel(null)}>
            {ar ? 'مساحتي في BHD R' : 'My BHD R workspace'}
          </Link>
          <Link href={`/${locale}/account`} onClick={() => setPanel(null)}>
            {ar ? 'صورتي وتوثيق حسابي ✓' : 'Picture & verification ✓'}
          </Link>
          <a href="https://id.bhd-om.com/account">{ar ? 'إدارة حساب BHD' : 'Manage BHD account'}</a>
          <form
            method="post"
            action={`/api/auth/bhd/logout?locale=${locale}`}
            className="bhd-switcher-account__logout"
          >
            <button type="submit">{ar ? 'تسجيل الخروج' : 'Sign out'}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
