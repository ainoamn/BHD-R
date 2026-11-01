import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { isAppLocale, localeConfig, locales } from '@bhd-r/i18n';
import { BhdSilentSso } from '@/components/bhd-silent-sso';
import { BhdPrivacyGate } from '@/components/bhd-privacy-gate';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SiteMaintenanceBanner } from '@/components/site-maintenance-banner';
import { MarketingRoutePrefetch } from '@/components/marketing-route-prefetch';
import { NavigationProgress } from '@/components/navigation-progress';
import Script from 'next/script';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { IDENTITY_SCRIPT_URL } from '@/lib/bhd/runtime';
import '../globals.css';

const publicWebOrigin =
  process.env.PUBLIC_WEB_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://r.bhd-om.com';

const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '600'],
  display: 'optional',
  adjustFontFallback: true,
  variable: '--font-arabic',
});
const latinFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'optional',
  adjustFontFallback: true,
  variable: '--font-latin',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#092d24',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';
  const title = isAr ? 'BHD R — إدارة العقارات' : 'BHD R — Real Estate Management';
  const description = isAr
    ? 'منصة عمانية ثنائية اللغة لإدارة العقارات والوحدات والعقود والمدفوعات والصيانة.'
    : 'Oman-first bilingual property management for owners, developers and tenants.';
  return {
    metadataBase: new URL(publicWebOrigin),
    title: { default: title, template: '%s · BHD R' },
    description,
    applicationName: 'BHD R',
    openGraph: {
      type: 'website',
      siteName: 'BHD R',
      title,
      description,
      images: [
        {
          url: '/og.png',
          width: 1200,
          height: 630,
          alt: 'BHD R — إدارة العقارات | Real Estate Management',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'BHD R — Real Estate Management',
      description: 'Clear property, lease and tenant operations.',
      images: ['/og.png'],
    },
    alternates: {
      canonical: `/${locale}`,
      languages: { ar: '/ar', en: '/en', 'x-default': '/ar' },
    },
    robots: { index: true, follow: true },
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${publicWebOrigin}/#organization`,
    name: 'BHD R',
    url: publicWebOrigin,
    logo: `${publicWebOrigin}/og.png`,
    areaServed: 'OM',
  };
  // Branded splash (~1.8s max) while ?au= binds — site loads behind the cover.
  const accountVeilBootstrap = `(function(){try{if(!new URL(location.href).searchParams.get('au'))return;var root=document.documentElement;root.setAttribute('data-bhd-switching','1');root.style.setProperty('--bhd-veil-ms','1800ms');var en=root.lang==='en';var html='<div class="bhd-account-veil__panel"><div class="bhd-account-veil__stage"><span class="bhd-account-veil__glow" aria-hidden="true"></span><span class="bhd-account-veil__ring" aria-hidden="true"></span><div class="bhd-account-veil__mark"><img src="/brand/bhd-official-symbol.svg" alt="" width="168" height="52" decoding="async" fetchpriority="high"/></div></div><p class="bhd-account-veil__caption">'+(en?'Loading your workspace…':'جاري تجهيز مساحتك…')+'</p><div class="bhd-account-veil__track" aria-hidden="true"><span class="bhd-account-veil__bar"></span></div></div>';var mount=function(){if(document.getElementById('bhd-privacy-veil'))return;var v=document.createElement('div');v.id='bhd-privacy-veil';v.className='bhd-account-veil';v.setAttribute('aria-hidden','true');v.innerHTML=html;(document.body||root).appendChild(v);window.setTimeout(function(){var el=document.getElementById('bhd-privacy-veil');if(!el||el.classList.contains('is-exiting'))return;el.classList.add('is-exiting');root.setAttribute('data-bhd-switching','0');window.setTimeout(function(){el&&el.remove();root.removeAttribute('data-bhd-switching');},320);},1800);};if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);}catch(e){}})();`;

  return (
    <html lang={locale} dir={localeConfig[locale].dir}>
      <body className={`${arabicFont.variable} ${latinFont.variable}`}>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: accountVeilBootstrap }} />
        <a className="skip-link" href="#main-content">
          {locale === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content'}
        </a>
        <Script src={IDENTITY_SCRIPT_URL} strategy="afterInteractive" />
        <NextIntlClientProvider messages={messages}>
          <BhdSilentSso />
          <BhdPrivacyGate />
          <NavigationProgress />
          <MarketingRoutePrefetch />
          <SiteMaintenanceBanner />
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
        <script type="application/ld+json" nonce={nonce}>
          {JSON.stringify(organization).replaceAll('<', '\\u003c')}
        </script>
      </body>
    </html>
  );
}
