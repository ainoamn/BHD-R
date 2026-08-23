'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { browserMutation } from '@/lib/api';
import type { Viewer } from '@/lib/types';

const apps = [
  { id: 'portal', ar: 'بوابة BHD', en: 'BHD Portal', mark: 'B', href: 'https://www.bhd-om.com/' },
  { id: 'account', ar: 'الحساب', en: 'Account', mark: 'حـ', href: 'https://id.bhd-om.com/account' },
  { id: 'wazen', ar: 'وازن', en: 'WAZEN', mark: 'و', href: 'https://wazen.bhd-om.com/' },
  { id: 'hisaby', ar: 'حسابي', en: 'HISABY', mark: 'ح', href: 'https://hisaby.bhd-om.com/' },
  { id: 'nasab', ar: 'نَسَب', en: 'NASAB', mark: 'ن', href: 'https://nasab.bhd-om.com/' },
  { id: 'real-estate', ar: 'BHD R', en: 'BHD R', mark: 'R', href: '/' },
  { id: 'store', ar: 'المتجر', en: 'BHD Store', mark: 'م', href: 'https://bhdstor.bhd-om.com/' },
] as const;

type Panel = 'apps' | 'account' | null;

export function BhdAppSwitcher({ viewer, locale }: { viewer: Viewer; locale: 'ar' | 'en' }) {
  const [panel, setPanel] = useState<Panel>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const appsId = useId();
  const accountId = useId();
  const initial = viewer.displayName.trim().slice(0, 1) || 'B';
  const ar = locale === 'ar';

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

  async function signOut() {
    await browserMutation('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign(`/${locale}`);
  }

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
              const current = app.id === 'real-estate';
              const href = current ? `/${locale}` : app.href;
              return (
                <a
                  key={app.id}
                  className={current ? 'bhd-switcher-app is-current' : 'bhd-switcher-app'}
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setPanel(null)}
                >
                  <span className={`bhd-app-mark bhd-app-mark--${app.id}`}>{app.mark}</span>
                  <span>{ar ? app.ar : app.en}</span>
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
          <a href={`/${locale}/portal`}>{ar ? 'مساحتي في BHD R' : 'My BHD R workspace'}</a>
          <a href="https://id.bhd-om.com/account">{ar ? 'إدارة حساب BHD' : 'Manage BHD account'}</a>
          <button type="button" onClick={() => void signOut()}>
            {ar ? 'تسجيل الخروج' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
