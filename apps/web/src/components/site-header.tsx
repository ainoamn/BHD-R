'use client';

import dynamic from 'next/dynamic';
import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { HeaderStayAlerts } from '@/components/header-stay-alerts';
import type { Viewer } from '@/lib/types';

const BhdAppSwitcher = dynamic(
  () => import('@/components/bhd-app-switcher').then((mod) => mod.BhdAppSwitcher),
  { ssr: false },
);

type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'signed-in'; viewer: Viewer };

export function SiteHeader() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const hidden =
    /^\/(platform|owner|developer|tenant|admin|site-admin|login|forgot-password|reset-password|activate)(\/|$)/.test(
      pathname,
    );

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2_500),
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as Viewer & { authenticated?: boolean };
        if (payload.authenticated === false || !payload.id) return null;
        return payload;
      })
      .then((viewer) => {
        if (!cancelled) setAuth(viewer ? { status: 'signed-in', viewer } : { status: 'anonymous' });
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'anonymous' });
      });
    return () => {
      cancelled = true;
    };
  }, [hidden]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (hidden) return null;
  const signInHref = `/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`;
  const authBusy = auth.status === 'loading';

  return (
    <header className="site-header">
      <div className="oman-flag-line" aria-hidden="true" />
      <div className="container header-row">
        <Link
          href="/"
          className="brand-link"
          scroll={false}
          aria-label={`${t('Brand.name')} — ${t('Common.home')}`}
        >
          <Logo descriptor={t('Brand.descriptor')} />
        </Link>
        <button
          className="mobile-menu"
          type="button"
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? '×' : '☰'}</span>
          <span className="sr-only">{open ? t('Common.closeMenu') : t('Common.openMenu')}</span>
        </button>
        <nav
          id="main-navigation"
          className={open ? 'main-nav main-nav--open' : 'main-nav'}
          aria-label={t('Common.home')}
        >
          <Link href="/properties" prefetch scroll={false} onClick={() => setOpen(false)}>
            {t('Nav.available')}
          </Link>
          <Link href="/#how-it-works" onClick={() => setOpen(false)}>
            {t('Nav.howItWorks')}
          </Link>
          <Link href="/trust" prefetch scroll={false} onClick={() => setOpen(false)}>
            {t('Nav.trust')}
          </Link>
          <Link href="/badges" scroll={false} onClick={() => setOpen(false)}>
            {locale === 'ar' ? 'الشارات' : 'Badges'}
          </Link>
          <Link
            href={pathname}
            locale={locale === 'ar' ? 'en' : 'ar'}
            className="language-link"
            hrefLang={locale === 'ar' ? 'en' : 'ar'}
          >
            {t('Nav.language')}
          </Link>
          <span className="header-auth-slot" data-auth={auth.status}>
            <span className="header-auth-slot__alerts">
              {auth.status === 'signed-in' ? (
                <HeaderStayAlerts locale={locale} signedIn />
              ) : (
                <span
                  className="header-stay-alerts__bell header-stay-alerts__bell--placeholder"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="header-auth-slot__cta">
              {auth.status === 'signed-in' ? (
                <>
                  <Link
                    href="/portal"
                    className="header-portal-link"
                    onClick={() => setOpen(false)}
                  >
                    {locale === 'ar' ? 'مساحتي' : 'Workspace'}
                  </Link>
                  <BhdAppSwitcher viewer={auth.viewer} locale={locale} />
                </>
              ) : (
                <a
                  href={signInHref}
                  className="button button--secondary"
                  aria-busy={authBusy || undefined}
                >
                  {t('Nav.login')}
                </a>
              )}
            </span>
          </span>
        </nav>
      </div>
    </header>
  );
}
