'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { BHD_APPS } from '@/lib/bhd/apps';

export function SiteFooter() {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';
  const ar = locale === 'ar';
  if (
    /^\/(platform|owner|developer|tenant|login|forgot-password|reset-password|activate)(\/|$)/.test(
      pathname,
    )
  )
    return null;

  const programmes = BHD_APPS.filter(
    (app) => app.enabled && app.id !== 'account' && app.id !== 'office',
  );

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo descriptor={t('Brand.descriptor')} />
          <p>{t('Brand.promise')}</p>
          <p className="muted">مسقط، سلطنة عُمان · Muscat, Sultanate of Oman</p>
        </div>
        <nav aria-label={ar ? 'برامجنا' : 'Our programmes'}>
          <strong>{ar ? 'برامجنا' : 'Our programmes'}</strong>
          {programmes.map((app) => (
            <a
              key={app.id}
              href={
                app.mode === 'sso' && app.startUrl
                  ? app.startUrl
                  : `${app.origin.replace(/\/$/, '')}/`
              }
            >
              {ar ? app.nameAr : app.nameEn}
            </a>
          ))}
          <a href="https://www.bhd-om.com/apps">
            {ar ? 'كل التطبيقات وشرحها' : 'All apps & guides'}
          </a>
        </nav>
        <nav aria-label={ar ? 'عن الشركة' : 'Company'}>
          <a href="https://www.bhd-om.com/about">{ar ? 'عن الشركة' : 'About'}</a>
          <a href="https://www.bhd-om.com/brand">{ar ? 'هوية الشركة' : 'Brand'}</a>
          <a href="https://www.bhd-om.com/privacy">{ar ? 'الخصوصية' : 'Privacy'}</a>
          <a href="https://www.bhd-om.com/terms">{ar ? 'الشروط' : 'Terms'}</a>
          <a href="https://www.bhd-om.com/security">{ar ? 'الأمان' : 'Security'}</a>
          <Link href="/trust">{t('Legal.trustTitle')}</Link>
          <Link href="/accessibility">{t('Legal.accessibilityTitle')}</Link>
          <a href="/api/auth/admin-entry">{ar ? 'دخول الإدارة' : 'Admin sign-in'}</a>
        </nav>
        <p className="copyright">© {new Date().getFullYear()} BHD R</p>
      </div>
    </footer>
  );
}
