import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../marketplace.css';
import { DirectoryBrowse } from '@/components/marketplace/directory-browse';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { Link } from '@/i18n/navigation';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale !== 'en';
  return {
    title: ar ? 'التأمين العقاري' : 'Property insurance',
    description: ar
      ? 'شركاء تأمين عقاري للمباني والمحتويات ومحافظ الإيجار في عُمان.'
      : 'Property insurance partners for buildings, contents and rental portfolios in Oman.',
    alternates: bilingualAlternates(locale, '/insurance'),
  };
}

export default async function InsurancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('insurance');

  const steps = ar
    ? [
        ['اختر الشريك', 'تصفّح شركات التأمين المسجّلة حسب المدينة والتغطية.'],
        ['حدد التغطية', 'مباني، محتويات، مسؤولية، أو حماية محفظة إيجار.'],
        ['تواصل مباشرة', 'اتصل أو راسل الشريك، أو سجّل ليصلك عرض لاحقاً.'],
      ]
    : [
        ['Pick a partner', 'Browse listed insurers by city and cover type.'],
        ['Choose cover', 'Buildings, contents, liability, or rental-portfolio protection.'],
        ['Contact directly', 'Call or email the partner, or register for a quote later.'],
      ];

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'شركاء التأمين' : 'Insurance partners'}
      title={ar ? 'التأمين العقاري' : 'Property insurance'}
      lead={
        ar
          ? 'احمِ عقارك أو محفظة الإيجار عبر شركاء تأمين جاهزين للتواصل — منفصل عن تأمين/وديعة العقد داخل المنصة.'
          : 'Protect your property or rental portfolio through ready-to-contact insurance partners — separate from in-app lease deposits.'
      }
      actions={
        <Link className="button button--gold button--small" href="/offices">
          {ar ? 'المكاتب العقارية' : 'Real estate offices'}
        </Link>
      }
      band={
        <div className="mkt-band">
          <h2>{ar ? 'شركة تأمين؟' : 'An insurer?'}</h2>
          <p>
            {ar
              ? 'أظهر منتجاتك العقارية أمام الملاك والمكاتب على BHD R.'
              : 'Surface your property products to landlords and offices on BHD R.'}
          </p>
          <div className="mkt-band__actions">
            <a
              className="button button--gold button--small"
              href={`/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`}
            >
              {ar ? 'انضم كشريك تأمين' : 'Join as an insurance partner'}
            </a>
          </div>
        </div>
      }
    >
      <div className="mkt-steps" aria-label={ar ? 'كيف يعمل' : 'How it works'}>
        {steps.map(([title, text], index) => (
          <div className="mkt-step" key={title}>
            <span className="mkt-step__n" aria-hidden="true">
              {index + 1}
            </span>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '1.5rem' }}>
        <DirectoryBrowse kind="insurer" locale={locale} joinHref={`/${locale}/portal`} />
      </div>
    </MarketplaceShell>
  );
}
