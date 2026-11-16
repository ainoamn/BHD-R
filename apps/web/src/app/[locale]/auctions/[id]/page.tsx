import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import '../../../auctions-projects.css';
import { AuctionDetailClient } from '@/components/auctions/auction-detail-client';
import {
  AUCTION_TABS,
  SectionShell,
} from '@/components/marketplace/section-shell';
import { getResolvedAuction } from '@/lib/auctions-catalogue';
import { loadAuctionBids } from '@/lib/auctions-bids-neon';
import { bilingualAlternates } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const ar = locale !== 'en';
  const auction = getResolvedAuction(id);
  if (!auction) return { title: ar ? 'مزاد' : 'Auction' };
  return {
    title: ar ? auction.titleAr : auction.titleEn,
    description: ar ? auction.descriptionAr : auction.descriptionEn,
    alternates: bilingualAlternates(locale, `/auctions/${id}`),
  };
}

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const ar = locale === 'ar';
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('auctions');

  const bids = await loadAuctionBids(id);
  const auction = getResolvedAuction(id, Date.now(), bids);
  if (!auction) notFound();

  return (
    <SectionShell
      locale={locale}
      brand="BHD R"
      title={ar ? auction.titleAr : auction.titleEn}
      lead={ar ? auction.locationAr : auction.locationEn}
      tabs={AUCTION_TABS(auction.status === 'active' || auction.status === 'upcoming' ? auction.status : 'all')}
    >
      <AuctionDetailClient locale={locale} auction={auction} />
    </SectionShell>
  );
}
