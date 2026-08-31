import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { StayCheckout } from '@/components/stays/stay-checkout';
import { StaySearch } from '@/components/stays/stay-search';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';

type StayDetail = {
  slug: string;
  titleAr?: string;
  titleEn?: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  destination?: string | null;
  nightlyMinor?: string | null;
  currency?: string | null;
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale, slug } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('Stays');
  const ar = locale === 'ar';

  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;

  const checkInOn = one(query.checkInOn);
  const checkOutOn = one(query.checkOutOn);
  const adults = one(query.adults);
  const children = one(query.children);

  const dateDefaults = {
    ...(checkInOn ? { checkInOn } : {}),
    ...(checkOutOn ? { checkOutOn } : {}),
    ...(adults ? { adults } : {}),
    ...(children ? { children } : {}),
  };

  const detail = await publicApiFetch<StayDetail>(
    `/v1/public/stays/${encodeURIComponent(slug)}`,
    8,
  ).catch(() => null);

  const title =
    (ar ? detail?.titleAr : detail?.titleEn) ||
    (ar ? 'إقامة يومية' : 'Daily stay');

  return (
    <div className="container section stays-public stays-public--detail">
      <p>
        <Link className="text-link" href="/stays">
          {ar ? '← كل الإقامات' : '← All stays'}
        </Link>
      </p>
      <header className="section-heading">
        <div>
          <span className="section-kicker">BHD R</span>
          <h1>{title}</h1>
          <p className="muted">{detail?.destination ?? t('shellHint')}</p>
        </div>
      </header>

      {!detail ? (
        <p className="notice notice--info" role="status">
          {t('comingOnline')}
        </p>
      ) : (
        <article className="ops-panel">
          <p>{(ar ? detail.descriptionAr : detail.descriptionEn) || t('detailTitle')}</p>
          {detail.nightlyMinor && detail.currency ? (
            <p>
              {t('nightlyFrom')}{' '}
              <strong dir="ltr">
                {detail.currency} {detail.nightlyMinor}
              </strong>{' '}
              {t('perNight')}
            </p>
          ) : null}
        </article>
      )}

      <div className="stays-public__book-shell">
        <StayCheckout locale={locale} slug={slug} defaults={dateDefaults} />
        <div className="stays-public__search-again">
          <h2>{t('searchTitle')}</h2>
          <StaySearch locale={locale} compact defaults={dateDefaults} />
        </div>
      </div>
    </div>
  );
}
