import '../../app/marketplace.css';
import { Link } from '@/i18n/navigation';

const SERVICES = [
  {
    href: '/offices',
    icon: 'م',
    ar: {
      title: 'المكاتب العقارية',
      text: 'دليل مكاتب البيع والإيجار في أنحاء السلطنة.',
      cta: 'استعرض المكاتب',
    },
    en: {
      title: 'Real estate offices',
      text: 'Directory of sales and rental offices across Oman.',
      cta: 'Browse offices',
    },
  },
  {
    href: '/appraisers',
    icon: 'ث',
    ar: {
      title: 'المثمّنون العقاريون',
      text: 'مثمّنون موثّقون للتمويل والبيع والمنازعات.',
      cta: 'استعرض المثمّنين',
    },
    en: {
      title: 'Property appraisers',
      text: 'Verified valuers for finance, sale and disputes.',
      cta: 'Browse appraisers',
    },
  },
  {
    href: '/insurance',
    icon: 'ت',
    ar: {
      title: 'التأمين العقاري',
      text: 'شركاء تأمين للمباني والمحتويات ومحافظ الإيجار.',
      cta: 'تعرّف على التأمين',
    },
    en: {
      title: 'Property insurance',
      text: 'Insurance partners for buildings, contents and rental portfolios.',
      cta: 'Explore insurance',
    },
  },
  {
    href: '/valuation',
    icon: 'ق',
    ar: {
      title: 'طلب تثمين',
      text: 'أرسل طلب تثمين ونربطك بمثّمن مناسب في منطقتك.',
      cta: 'اطلب تثمين',
    },
    en: {
      title: 'Request valuation',
      text: 'Submit a valuation request and we match an appraiser near you.',
      cta: 'Request valuation',
    },
  },
] as const;

export function HomeServicesSection({ locale }: { locale: string }) {
  const ar = locale !== 'en';
  return (
    <section
      id="marketplace-services"
      className="home-section home-services"
      aria-labelledby="home-services-title"
    >
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">
              <i aria-hidden="true" />
              {ar ? 'خدمات السوق' : 'Market services'}
            </span>
            <h2 id="home-services-title">
              {ar ? 'مكاتب · تثمين · تأمين' : 'Offices · Valuation · Insurance'}
            </h2>
            <p>
              {ar
                ? 'صفحات جاهزة للدليل وطلب التثمين — انضم كشريك أو تصفّح المتاح الآن.'
                : 'Ready directory and valuation pages — join as a partner or browse who is listed.'}
            </p>
          </div>
          <Link className="home-head__link" href="/offices">
            {ar ? 'كل الخدمات' : 'All services'}
          </Link>
        </header>
        <div className="home-services__grid">
          {SERVICES.map((service) => {
            const copy = ar ? service.ar : service.en;
            return (
              <Link key={service.href} className="home-service" href={service.href}>
                <span className="home-service__icon" aria-hidden="true">
                  {service.icon}
                </span>
                <strong>{copy.title}</strong>
                <p>{copy.text}</p>
                <span>{copy.cta} →</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
