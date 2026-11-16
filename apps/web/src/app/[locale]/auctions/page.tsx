import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import '../../auctions-projects.css';
import { AuctionsBrowse } from '@/components/auctions/auctions-browse';
import {
  AUCTION_TABS,
  SectionShell,
} from '@/components/marketplace/section-shell';
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
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? 'المزادات العقارية' : 'Real estate auctions'}
      lead={
        ar
          ? 'مزادات واضحة بعدّ تنازلي ومزايدة مباشرة — بلا تشويش.'
          : 'Clear auctions with countdowns and direct bidding — no clutter.'
      }
      tabs={AUCTION_TABS(initialStatus === 'all' ? 'all' : initialStatus)}
      actions={
        <Link className="button button--primary button--small" href="/auctions/new">
          {ar ? 'إنشاء مزاد' : 'Create auction'}
        </Link>
      }
    >
      <AuctionsBrowse locale={locale} auctions={auctions} initialStatus={initialStatus} />
    </SectionShell>
  );
}
