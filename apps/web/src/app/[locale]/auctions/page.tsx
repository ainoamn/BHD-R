import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../marketplace.css';
import '../../auctions-projects.css';
import { AuctionsBrowse } from '@/components/auctions/auctions-browse';
import { MarketplaceShell } from '@/components/marketplace/marketplace-shell';
import { Link } from '@/i18n/navigation';
import { listResolvedAuctions } from '@/lib/auctions-catalogue';
import { loadAuctionBidsMap } from '@/lib/auctions-bids-neon';
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
    title: ar ? 'المزادات العقارية' : 'Real estate auctions',
    description: ar
      ? 'مزادات عقارية في سلطنة عُمان — شقق، فلل، أراضي وفرص استثمارية.'
      : 'Real estate auctions in Oman — apartments, villas, land and investment opportunities.',
    alternates: bilingualAlternates(locale, '/auctions'),
  };
}

export default async function AuctionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('auctions');

  const query = await searchParams;
  const statusRaw = typeof query.status === 'string' ? query.status : '';
  const initialStatus =
    statusRaw === 'active' || statusRaw === 'upcoming' || statusRaw === 'ended'
      ? statusRaw
      : 'all';

  const bids = await loadAuctionBidsMap();
  const auctions = listResolvedAuctions(Date.now(), bids);

  return (
    <MarketplaceShell
      locale={locale}
      kicker={ar ? 'مزادات BHD R' : 'BHD R auctions'}
      title={ar ? 'المزايدات العقارية' : 'Real estate auctions'}
      lead={
        ar
          ? 'اكتشف الفرص العقارية بالمزايدة — عدّ تنازلي، سجل مزايدات، وتصفح حسب الحالة.'
          : 'Discover auction opportunities with live countdowns, bid history and status filters.'
      }
      actions={
        <>
          <Link className="button button--gold button--small" href="/auctions/new">
            {ar ? 'إنشاء مزاد' : 'Create auction'}
          </Link>
          <Link className="button button--secondary button--small" href="/projects">
            {ar ? 'مشاريع التطوير' : 'Development projects'}
          </Link>
        </>
      }
    >
      <AuctionsBrowse locale={locale} auctions={auctions} initialStatus={initialStatus} />
    </MarketplaceShell>
  );
}
