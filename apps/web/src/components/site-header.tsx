'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { ActiveAccountChip } from '@/components/active-account-chip';
import { HeaderStayAlerts } from '@/components/header-stay-alerts';
import type { Viewer } from '@/lib/types';

type AuthState =
  { status: 'loading' } | { status: 'anonymous' } | { status: 'signed-in'; viewer: Viewer };

type NavChild = { href: string; ar: string; en: string };
type NavGroup = {
  id: string;
  href: string;
  ar: string;
  en: string;
  badge?: { ar: string; en: string; tone: 'new' | 'hot' };
  children?: NavChild[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    href: '/',
    ar: 'الرئيسية',
    en: 'Home',
  },
  {
    id: 'properties',
    href: '/properties',
    ar: 'العقارات',
    en: 'Properties',
    badge: { ar: 'جديد', en: 'New', tone: 'new' },
    children: [
      { href: '/properties?purpose=rent', ar: 'عقار للإيجار', en: 'For rent' },
      { href: '/properties?purpose=sale', ar: 'عقار للبيع', en: 'For sale' },
      { href: '/stays', ar: 'إقامة يومية', en: 'Daily stay' },
      { href: '/properties', ar: 'جميع العقارات', en: 'All properties' },
      { href: '/properties?category=apartment', ar: 'شقق', en: 'Apartments' },
      { href: '/properties?category=villa', ar: 'فيلات', en: 'Villas' },
      { href: '/properties?category=building', ar: 'مبانٍ', en: 'Buildings' },
      { href: '/properties?category=office', ar: 'مكاتب', en: 'Offices' },
      { href: '/properties?category=shop', ar: 'محلات', en: 'Shops' },
      { href: '/properties?category=warehouse', ar: 'مستودعات', en: 'Warehouses' },
      { href: '/properties?category=land', ar: 'أراضٍ', en: 'Land' },
      { href: '/properties?category=other', ar: 'أخرى', en: 'Other' },
    ],
  },
  {
    id: 'auctions',
    href: '/auctions',
    ar: 'المزادات',
    en: 'Auctions',
    badge: { ar: 'مميز', en: 'Featured', tone: 'hot' },
    children: [
      { href: '/auctions?status=active', ar: 'المزادات الحالية', en: 'Current auctions' },
      { href: '/auctions?status=upcoming', ar: 'مزادات قادمة', en: 'Upcoming auctions' },
      { href: '/auctions/my', ar: 'مزاداتي', en: 'My auctions' },
      { href: '/auctions/new', ar: 'إنشاء مزاد', en: 'Create auction' },
    ],
  },
  {
    id: 'development',
    href: '/projects',
    ar: 'التطوير العقاري',
    en: 'Development',
    children: [
      { href: '/projects', ar: 'المشاريع', en: 'Projects' },
      { href: '/projects/opportunities', ar: 'الفرص الاستثمارية', en: 'Investment opportunities' },
      { href: '/projects/financing', ar: 'التمويل', en: 'Financing' },
      { href: '/projects/partners', ar: 'الشركاء', en: 'Partners' },
    ],
  },
  {
    id: 'services',
    href: '/offices',
    ar: 'الخدمات',
    en: 'Services',
    children: [
      { href: '/offices', ar: 'المكاتب العقارية', en: 'Real estate offices' },
      { href: '/appraisers', ar: 'المثمّنون', en: 'Appraisers' },
      { href: '/insurance', ar: 'التأمين', en: 'Insurance' },
      { href: '/valuation', ar: 'طلب تثمين', en: 'Valuation request' },
    ],
  },
];

function NavDropdown({
  group,
  locale,
  mobile,
  onNavigate,
}: {
  group: NavGroup;
  locale: 'ar' | 'en';
  mobile: boolean;
  onNavigate: () => void;
}) {
  const ar = locale === 'ar';
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = ar ? group.ar : group.en;
  const hasChildren = Boolean(group.children?.length);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, mobile]);

  if (!hasChildren) {
    return (
      <Link href={group.href} className="nav-link" prefetch scroll={false} onClick={onNavigate}>
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <div
      ref={rootRef}
      className={open ? 'nav-item is-open' : 'nav-item'}
      onMouseEnter={() => {
        if (!mobile) setOpen(true);
      }}
      onMouseLeave={() => {
        if (!mobile) setOpen(false);
      }}
    >
      <button
        type="button"
        className="nav-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nav-trigger__label">{label}</span>
        {group.badge ? (
          <span className={`nav-badge nav-badge--${group.badge.tone}`}>
            {ar ? group.badge.ar : group.badge.en}
          </span>
        ) : null}
        <span className="nav-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <div id={panelId} className="nav-drop" hidden={!open}>
        <ul>
          {group.children!.map((child) => (
            <li key={`${group.id}-${child.href}-${child.ar}`}>
              <Link
                href={child.href}
                prefetch
                scroll={false}
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                {ar ? child.ar : child.en}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [isMobile, setIsMobile] = useState(false);
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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1080px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (hidden) return null;
  const signInHref = `/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`;
  const authBusy = auth.status === 'loading';
  const closeMenu = () => setOpen(false);

  const authSlot: ReactNode = (
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
            <Link href="/portal" className="header-portal-link" onClick={closeMenu}>
              {locale === 'ar' ? 'مساحتي' : 'Workspace'}
            </Link>
            <ActiveAccountChip viewer={auth.viewer} locale={locale} />
          </>
        ) : (
          <a href={signInHref} className="button button--secondary" aria-busy={authBusy || undefined}>
            {t('Nav.login')}
          </a>
        )}
      </span>
    </span>
  );

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
          aria-label={locale === 'ar' ? 'القائمة الرئيسية' : 'Main navigation'}
        >
          {NAV_GROUPS.map((group) => (
            <NavDropdown
              key={group.id}
              group={group}
              locale={locale}
              mobile={isMobile}
              onNavigate={closeMenu}
            />
          ))}
          <Link href="/trust" className="nav-link" prefetch scroll={false} onClick={closeMenu}>
            {t('Nav.trust')}
          </Link>
          <Link href="/badges" className="nav-link" scroll={false} onClick={closeMenu}>
            {locale === 'ar' ? 'الشارات' : 'Badges'}
          </Link>
          <Link
            href={pathname}
            locale={locale === 'ar' ? 'en' : 'ar'}
            className="language-link nav-link"
            hrefLang={locale === 'ar' ? 'en' : 'ar'}
            onClick={closeMenu}
          >
            {t('Nav.language')}
          </Link>
          {authSlot}
        </nav>
      </div>
    </header>
  );
}
