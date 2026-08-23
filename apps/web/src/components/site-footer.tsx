'use client';

import { Logo } from '@bhd-r/ui';
import { useLocale } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { BHD_APPS, type BhdApp } from '@/lib/bhd/apps';
import { BhdAppIcon } from '@/components/bhd/bhd-app-icon';

/** Same product order and labels as www.bhd-om.com footer (ONE-BHD SiteFooter). */
const FOOTER_PROGRAMS = [
  { id: 'wazen', nameAr: 'وازن', nameEn: 'WAZEN' },
  { id: 'hisaby', nameAr: 'حسابي', nameEn: 'HISABY' },
  { id: 'baitak', nameAr: 'بيتك', nameEn: 'BAITAK' },
  { id: 'nasab', nameAr: 'نَسَب', nameEn: 'NASAB' },
  { id: 'store', nameAr: 'متجر BHD', nameEn: 'BHD Store' },
  { id: 'office', nameAr: 'مكتب BHD', nameEn: 'BHD Office' },
] as const;

function hrefForApp(app: BhdApp): string {
  if (app.mode === 'sso' && app.startUrl) return app.startUrl;
  return `${app.origin.replace(/\/$/, '')}/`;
}

export function SiteFooter() {
  const pathname = usePathname();
  const locale = useLocale() as 'ar' | 'en';
  const ar = locale === 'ar';

  if (
    /^\/(platform|owner|developer|tenant|login|forgot-password|reset-password|activate)(\/|$)/.test(
      pathname,
    )
  ) {
    return null;
  }

  const programmes = FOOTER_PROGRAMS.flatMap((item) => {
    const app = BHD_APPS.find((candidate) => candidate.id === item.id && candidate.enabled);
    return app ? [{ ...item, app }] : [];
  });

  return (
    <footer className="site-footer">
      <div className="container footer-programs">
        <div className="footer-programs-head">
          <p>{ar ? 'برامجنا' : 'Our programmes'}</p>
          <a href="https://www.bhd-om.com/apps">
            {ar ? 'كل التطبيقات وشرحها' : 'All apps & guides'}
          </a>
        </div>
        <div className="footer-programs-grid" role="list">
          {programmes.map(({ id, nameAr, nameEn, app }) => (
            <a
              key={id}
              href={hrefForApp(app)}
              className="footer-program"
              title={ar ? nameAr : nameEn}
              role="listitem"
            >
              <BhdAppIcon id={id} title={ar ? nameAr : nameEn} />
              <span>{ar ? nameAr : nameEn}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="container footer-top">
        <div className="footer-brand">
          <Logo descriptor={ar ? 'بن حمود للتطوير' : 'Bin Hamood Development'} />
        </div>
        <p>{ar ? 'ابنِ أحلامًا أكبر.' : 'Build Higher Dreams.'}</p>
        <nav className="footer-links" aria-label={ar ? 'روابط الشركة' : 'Company links'}>
          <a href="https://www.bhd-om.com/about">{ar ? 'عن الشركة' : 'About'}</a>
          <a href="https://www.bhd-om.com/brand">{ar ? 'هوية الشركة' : 'Brand'}</a>
          <a href="https://www.bhd-om.com/apps">{ar ? 'برامجنا' : 'Programmes'}</a>
          <a href="https://www.bhd-om.com/privacy">{ar ? 'الخصوصية' : 'Privacy'}</a>
          <a href="https://www.bhd-om.com/terms">{ar ? 'الشروط' : 'Terms'}</a>
          <a href="https://www.bhd-om.com/security">{ar ? 'الأمان' : 'Security'}</a>
          <a href="/api/auth/admin-entry">{ar ? 'دخول الإدارة' : 'Admin sign-in'}</a>
        </nav>
      </div>

      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()}{' '}
          {ar
            ? 'شركة بن حمود للتطوير. جميع الحقوق محفوظة.'
            : 'Bin Hamood Development. All rights reserved.'}
        </span>
        <span>{ar ? 'مسقط · سلطنة عُمان' : 'Muscat · Sultanate of Oman'}</span>
      </div>
    </footer>
  );
}
