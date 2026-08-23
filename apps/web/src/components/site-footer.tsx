'use client';

import { Logo } from '@bhd-r/ui';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export function SiteFooter() {
  const t = useTranslations();
  const pathname = usePathname();
  if (
    /^\/(platform|owner|developer|tenant|login|forgot-password|reset-password|activate)(\/|$)/.test(
      pathname,
    )
  )
    return null;
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo descriptor={t('Brand.descriptor')} />
          <p>{t('Brand.promise')}</p>
          <p className="muted">مسقط، سلطنة عُمان · Muscat, Sultanate of Oman</p>
        </div>
        <nav aria-label="Legal">
          <Link href="/trust">{t('Legal.trustTitle')}</Link>
          <Link href="/privacy">{t('Legal.privacyTitle')}</Link>
          <Link href="/terms">{t('Legal.termsTitle')}</Link>
          <Link href="/accessibility">{t('Legal.accessibilityTitle')}</Link>
        </nav>
        <p className="copyright">© {new Date().getFullYear()} BHD R</p>
      </div>
    </footer>
  );
}
