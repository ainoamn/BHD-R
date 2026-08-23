'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

export function SiteHeader() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (/^\/(platform|owner|developer|tenant)(\/|$)/.test(pathname)) return null;
  return (
    <header className="site-header">
      <div className="container header-row">
        <Link
          href="/"
          className="brand-link"
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
          <Link href="/properties" onClick={() => setOpen(false)}>
            {t('Nav.available')}
          </Link>
          <Link href="/#how-it-works" onClick={() => setOpen(false)}>
            {t('Nav.howItWorks')}
          </Link>
          <Link href="/trust" onClick={() => setOpen(false)}>
            {t('Nav.trust')}
          </Link>
          <Link href="/login" className="button button--secondary" onClick={() => setOpen(false)}>
            {t('Nav.login')}
          </Link>
          <Link
            href={pathname}
            locale={locale === 'ar' ? 'en' : 'ar'}
            className="language-link"
            hrefLang={locale === 'ar' ? 'en' : 'ar'}
          >
            {t('Nav.language')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
