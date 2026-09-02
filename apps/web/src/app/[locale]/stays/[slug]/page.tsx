import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { StayCheckout } from '@/components/stays/stay-checkout';
import { StayPublicShowcase } from '@/components/stays/stay-public-showcase';
import { StaySearch } from '@/components/stays/stay-search';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicStayBySlugOnNeon } from '@/lib/load-public-stays-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';
import { localizedName } from '@/lib/format';
import type { StayPublicDetail } from '@bhd-r/contracts';

async function loadStayDetail(slug: string): Promise<StayPublicDetail | null> {
  if (hasDatabaseUrl()) {
    try {
      const neon = await loadPublicStayBySlugOnNeon(slug);
      if (neon) return neon;
    } catch (error) {
      console.error('Neon public stay load failed', error);
    }
  }
  return publicApiFetch<StayPublicDetail>(
    `/v1/public/stays/${encodeURIComponent(slug)}`,
    8,
  ).catch(() => null);
}

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

  const detail = await loadStayDetail(slug);

  return (
    <div className="container section stays-public stays-public--detail">
      <p>
        <Link className="text-link" href="/stays">
          {ar ? '← كل الإقامات' : '← All stays'}
        </Link>
      </p>

      {!detail ? (
        <>
          <header className="section-heading">
            <div>
              <span className="section-kicker">BHD R</span>
              <h1>{ar ? 'إقامة يومية' : 'Daily stay'}</h1>
              <p className="muted">{t('shellHint')}</p>
            </div>
          </header>
          <p className="notice notice--info" role="status">
            {t('comingOnline')}
          </p>
        </>
      ) : (
        <StayPublicShowcase detail={detail} locale={locale} />
      )}

      <div className="stays-public__book-shell stays-public__book-shell--split">
        <StayCheckout
          locale={locale}
          slug={slug}
          {...(detail
            ? { title: localizedName(locale, detail.titleAr, detail.titleEn) }
            : {})}
          defaults={dateDefaults}
        />
        <div className="stays-public__search-again">
          <h2>{t('searchTitle')}</h2>
          <StaySearch locale={locale} compact defaults={dateDefaults} />
        </div>
      </div>
    </div>
  );
}
