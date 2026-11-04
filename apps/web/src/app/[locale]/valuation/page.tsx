import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../marketplace.css';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { ValuationRequestForm } from '@/components/marketplace/valuation-request-form';
import { Link } from '@/i18n/navigation';
import { featuredMarketplace } from '@/lib/marketplace-directory';
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
    title: ar ? 'طلب تثمين عقاري' : 'Property valuation request',
    description: ar
      ? 'اطلب تثمين عقارك وسنربطك بمثّمن مناسب في منطقتك.'
      : 'Request a property valuation and we will match an appraiser in your area.',
    alternates: bilingualAlternates(locale, '/valuation'),
  };
}

export default async function ValuationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('valuation');

  const featured = featuredMarketplace('appraiser', 3);
  const steps = ar
    ? [
        ['أرسل الطلب', 'بيانات العقار والتواصل في نموذج واحد.'],
        ['نراجع ونطابق', 'نختار مثمّناً مناسباً حسب المدينة ونوع العقار.'],
        ['يتواصل المثمّن', 'يصلك عرض أو موعد معاينة مباشرة من المثمّن.'],
      ]
    : [
        ['Submit the request', 'Property and contact details in one form.'],
        ['We review & match', 'We pick an appraiser by city and property type.'],
        ['Appraiser contacts you', 'You receive a quote or inspection appointment.'],
      ];

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'التثمين' : 'Valuation'}
      title={ar ? 'اطلب تثمين عقارك' : 'Request a property valuation'}
      lead={
        ar
          ? 'للتأمين البنكي، البيع، أو معرفة القيمة السوقية — املأ النموذج أو تصفّح المثمّنين مباشرة.'
          : 'For bank finance, sale, or market value — fill the form or browse appraisers directly.'
      }
      actions={
        <Link className="button button--secondary button--small" href="/appraisers">
          {ar ? 'تصفّح المثمّنين' : 'Browse appraisers'}
        </Link>
      }
      band={
        <div className="mkt-band">
          <h2>{ar ? 'مثمّنون مميّزون' : 'Featured appraisers'}</h2>
          <p>
            {featured
              .map((row) => (ar ? row.nameAr : row.nameEn))
              .join(ar ? ' · ' : ' · ') || (ar ? 'قائمة المثمّنين جاهزة.' : 'Appraiser list is ready.')}
          </p>
          <div className="mkt-band__actions">
            <Link className="button button--gold button--small" href="/appraisers">
              {ar ? 'كل المثمّنين' : 'All appraisers'}
            </Link>
          </div>
        </div>
      }
    >
      <div className="mkt-steps" aria-label={ar ? 'خطوات التثمين' : 'Valuation steps'}>
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
      <ValuationRequestForm locale={locale} />
    </MarketplaceShell>
  );
}
