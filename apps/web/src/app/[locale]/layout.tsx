import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { isAppLocale, localeConfig, locales } from '@bhd-r/i18n';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import '../globals.css';

const publicWebOrigin =
  process.env.PUBLIC_WEB_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://r.bhd-om.com';

const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-arabic',
});
const latinFont = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-latin' });

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
  return (
    <html lang={locale} dir={localeConfig[locale].dir}>
      <body className={`${arabicFont.variable} ${latinFont.variable}`}>
        <a className="skip-link" href="#main-content">
          {locale === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content'}
        </a>
        <NextIntlClientProvider messages={messages}>
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
