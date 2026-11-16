import { NextResponse } from 'next/server';
import { getResolvedAuction } from '@/lib/auctions-catalogue';
import { loadAuctionBids, placeAuctionBid } from '@/lib/auctions-bids-neon';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const listing = getResolvedAuction(id);
  if (!listing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (listing.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'not_active' }, { status: 409 });
  }

  let body: { amount?: unknown; bidderName?: unknown };
  try {
    body = (await request.json()) as { amount?: unknown; bidderName?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  const bidderName = typeof body.bidderName === 'string' ? body.bidderName : '';
  const minAmount = listing.currentBid + 1;
  const result = await placeAuctionBid({
    auctionId: id,
    amount,
    bidderName,
    minAmount,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const bids = await loadAuctionBids(id);
  // Ensure the just-placed bid is visible even if DB write skipped
  if (!bids.some((b) => b.id === result.bid.id)) {
    bids.unshift(result.bid);
  }
  const auction = getResolvedAuction(id, Date.now(), bids);
  return NextResponse.json({ ok: true, bid: result.bid, auction });
}
