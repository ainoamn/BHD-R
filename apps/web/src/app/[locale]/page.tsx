import Image from 'next/image';
import { EmptyState, Logo } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ListingCard } from '@/components/listing-card';
import { PropertySearch } from '@/components/property-search';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { publicApiFetch } from '@/lib/server-api';
import type { ListingCollection } from '@/lib/types';

const homeCopy = {
  ar: {
    heroNote: 'من عُمان، بمعيار يليق بعقارك',
    proofTitle: 'منظومة واحدة لكل دورة العقار',
    proofItems: ['إشغال لحظي', 'عقود إلكترونية', 'تحصيل منضبط', 'صيانة موثقة'],
    live: 'المتاح يظهر. المؤجر والمحجوز يختفي تلقائياً.',
    stats: [
      ['4', 'بوابات مستقلة حسب الدور'],
      ['7+', 'عملات خليجية ودولية'],
      ['100%', 'عقود ومسارات موثقة'],
      ['24/7', 'وصول آمن إلى الالتزامات'],
    ],
    journeyEyebrow: 'كيف يعمل BHD R',
    journeyTitle: 'رحلة العقار، مرتبة من أول إضافة إلى آخر تحصيل.',
    journeyText:
      'لا نخلط الأنظمة ولا نكرر البيانات. كل خطوة تسلّم التالية حالة واضحة وصلاحية محددة وسجلاً قابلاً للمراجعة.',
    steps: [
      ['01', 'أضف العقار', 'فردي أو متعدد الوحدات مع العنوان والتفاصيل والصور.'],
      ['02', 'انشر المتاح', 'لا تظهر إلا الوحدات المنشورة والمتاحة فعلياً.'],
      ['03', 'وقّع العقد', 'توقيع إلكتروني ومسار اعتماد واضح لكل طرف.'],
      ['04', 'تابع التشغيل', 'فواتير ومدفوعات وصيانة وتقارير في سجل واحد.'],
    ],
    rolesEyebrow: 'مساحات لا تتداخل',
    rolesTitle: 'كل مستخدم يرى ما له وما عليه فقط.',
    roles: [
      ['المالك', 'محفظة العقارات، الإشغال، التحصيل، العقود والفريق المفوض.'],
      ['المطور', 'المشاريع والوحدات والعقود والتقارير التشغيلية من مساحة مستقلة.'],
      ['المستأجر', 'العقد والفواتير والإيصالات والصيانة دون كشف بيانات الإدارة.'],
    ],
    identityEyebrow: 'هوية BHD العُمانية',
    identityTitle: 'جذور ثابتة. إدارة تتحرك مع المستقبل.',
    identityText:
      'استلهمنا الهدوء والثبات من العمارة العُمانية، وربطناهما بهندسة رقمية خفيفة تخدم المالك والمطور والمستأجر بلغتهم وسياقهم.',
    identityQuote: 'عقارك. عقدك. كل شيء واضح.',
    ctaTitle: 'عقار واحد أو محفظة كاملة—ابدأ من مساحة مصممة لدورك.',
    ctaText: 'حساب BHD واحد، وصلاحيات مستقلة داخل BHD R، وبيانات كل مؤسسة معزولة.',
    portal: 'افتح مساحتك',
  },
  en: {
    heroNote: 'From Oman, built to a higher property standard',
    proofTitle: 'One system for the full property lifecycle',
    proofItems: ['Live occupancy', 'E-signatures', 'Controlled collection', 'Tracked maintenance'],
    live: 'Available units appear. Leased and reserved units disappear automatically.',
    stats: [
      ['4', 'role-specific portals'],
      ['7+', 'GCC and international currencies'],
      ['100%', 'traceable lease workflows'],
      ['24/7', 'secure access to obligations'],
    ],
    journeyEyebrow: 'How BHD R works',
    journeyTitle: 'A clear property journey, from onboarding to collection.',
    journeyText:
      'No merged systems or duplicated records. Every step hands the next one a clear status, a precise permission and an auditable trail.',
    steps: [
      ['01', 'Add the property', 'Single or multi-unit, with address, details and images.'],
      [
        '02',
        'Publish availability',
        'Only published units that are genuinely available are shown.',
      ],
      ['03', 'Sign the lease', 'Electronic signatures with a clear approval path for every party.'],
      ['04', 'Run operations', 'Invoices, payments, maintenance and reports in one record.'],
    ],
    rolesEyebrow: 'Spaces that never overlap',
    rolesTitle: 'Every user sees only what belongs to their role.',
    roles: [
      ['Owner', 'Portfolio, occupancy, collections, leases and delegated team access.'],
      ['Developer', 'Projects, units, leases and operational reports in a separate workspace.'],
      ['Tenant', 'Lease, invoices, receipts and maintenance without exposing management data.'],
    ],
    identityEyebrow: 'Omani BHD identity',
    identityTitle: 'Deep roots. Property operations ready for what comes next.',
    identityText:
      'Omani architecture lends the experience its calm and permanence; lightweight engineering makes it useful to owners, developers and tenants in their language and context.',
    identityQuote: 'Your property. Your lease. Clearly managed.',
    ctaTitle: 'One property or a complete portfolio—start in the workspace built for your role.',
    ctaText:
      'One BHD account, independent permissions inside BHD R and isolated data for every organization.',
    portal: 'Open your workspace',
  },
} as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const copy = homeCopy[locale === 'en' ? 'en' : 'ar'];
  const emptyListings = { data: [], pagination: { nextCursor: null, hasMore: false } };
  let listings = emptyListings as ListingCollection;
  let neonOk = false;
  if (hasDatabaseUrl()) {
    try {
      const { searchPublicListingsFromNeon } = await import('@/lib/search-public-listings-neon');
      listings = await searchPublicListingsFromNeon({ limit: 6 });
      neonOk = true;
    } catch {
      listings = emptyListings;
    }
  }
  // Only hit Nest when Neon is unavailable/errored — empty Neon catalogue is a valid result.
  if (!neonOk && !listings.data.length) {
    listings = await publicApiFetch<ListingCollection>(
      `/v1/public/listings?locale=${locale}&limit=6`,
      30,
    ).catch(() => emptyListings);
  }

  return (
    <>
      <section className="hero hero--oman">
        <Image
          className="hero__image"
          src="/images/oman/fort-bg.webp"
          alt={
            locale === 'ar'
              ? 'حصن عُماني بين الجبال والنخيل'
              : 'An Omani fort among mountains and palms'
          }
          fill
          priority
          sizes="100vw"
        />
        <div className="hero__veil" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-content">
            <span className="eyebrow eyebrow--light">{copy.heroNote}</span>
            <h1>{t('Home.title')}</h1>
            <p className="hero-copy">{t('Home.subtitle')}</p>
            <div className="hero-actions">
              <Link href="/properties" className="button button--gold">
                {t('Home.cta')}
                <span aria-hidden="true">←</span>
              </Link>
              <a
                href={`/v1/auth/oidc/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`}
                className="button button--glass"
              >
                {t('Nav.login')}
              </a>
            </div>
          </div>

          <aside className="hero-proof" aria-label={copy.proofTitle}>
            <div className="hero-proof__brand">
              <Logo descriptor={t('Brand.descriptor')} />
              <span>{locale === 'ar' ? 'منتج من منظومة BHD' : 'A BHD product'}</span>
            </div>
            <h2>{copy.proofTitle}</h2>
            <ul>
              {copy.proofItems.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="hero-proof__live">
              <i aria-hidden="true" />
              {copy.live}
            </p>
          </aside>
        </div>
        <div className="container hero-search">
          <PropertySearch locale={locale} />
        </div>
      </section>

      <section
        className="trust-strip"
        aria-label={locale === 'ar' ? 'مزايا المنصة' : 'Platform advantages'}
      >
        <div className="container trust-strip__grid">
          {copy.stats.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="featured-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t('Home.availableNow')}</span>
              <h2 id="featured-title">{t('Home.featured')}</h2>
              <p>{t('Home.featuredHint')}</p>
            </div>
            <Link className="text-link" href="/properties">
              {t('Common.viewAll')} <span aria-hidden="true">←</span>
            </Link>
          </div>
          {listings.data.length ? (
            <div className="listing-grid">
              {listings.data.map((listing) => (
                <ListingCard key={listing.id} listing={listing} locale={locale} />
              ))}
            </div>
          ) : (
            <EmptyState title={t('Common.noResults')} description={t('Home.featuredHint')} />
          )}
        </div>
      </section>

      <section id="how-it-works" className="section journey-section">
        <div className="container journey-layout">
          <div className="journey-intro">
            <span className="section-kicker section-kicker--gold">{copy.journeyEyebrow}</span>
            <h2>{copy.journeyTitle}</h2>
            <p>{copy.journeyText}</p>
          </div>
          <ol className="journey-steps">
            {copy.steps.map(([number, title, text]) => (
              <li key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section role-section" aria-labelledby="roles-title">
        <div className="container">
          <div className="section-heading section-heading--center">
            <span className="section-kicker">{copy.rolesEyebrow}</span>
            <h2 id="roles-title">{copy.rolesTitle}</h2>
          </div>
          <div className="role-grid">
            {copy.roles.map(([title, text], index) => (
              <article key={title} className="role-card">
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="oman-identity">
        <div className="oman-identity__image">
          <Image
            src="/images/oman/oman-alam-palace.webp"
            alt={locale === 'ar' ? 'قصر العلم في مسقط' : 'Al Alam Palace in Muscat'}
            fill
            sizes="(max-width: 900px) 100vw, 50vw"
          />
        </div>
        <div className="oman-identity__content">
          <span className="section-kicker section-kicker--gold">{copy.identityEyebrow}</span>
          <h2>{copy.identityTitle}</h2>
          <p>{copy.identityText}</p>
          <blockquote>{copy.identityQuote}</blockquote>
          <span className="oman-identity__place">
            مسقط · سلطنة عُمان · Muscat, Sultanate of Oman
          </span>
        </div>
      </section>

      <section className="section final-cta">
        <div className="container final-cta__inner">
          <div>
            <span className="section-kicker section-kicker--gold">BHD R</span>
            <h2>{copy.ctaTitle}</h2>
            <p>{copy.ctaText}</p>
          </div>
          <a
            href={`/v1/auth/oidc/start?returnTo=${encodeURIComponent(`/${locale}/portal`)}`}
            className="button button--gold"
          >
            {copy.portal}
            <span aria-hidden="true">←</span>
          </a>
        </div>
      </section>
    </>
  );
}
