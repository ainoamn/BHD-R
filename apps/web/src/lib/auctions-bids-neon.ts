import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { platformSettings } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { elevatedTx, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import type { AuctionBid } from '@/lib/auctions-catalogue';

const BIDS_KEY = 'public_auction_bids';

type BidsStore = {
  byAuction: Record<string, AuctionBid[]>;
  updatedAt: string | null;
};

async function readStore(tx: ElevatedTx): Promise<BidsStore> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from platform_settings where key = ${BIDS_KEY} limit 1`),
  );
  const value = row?.value as BidsStore | null;
  if (!value || typeof value !== 'object') {
    return { byAuction: {}, updatedAt: null };
  }
  return {
    byAuction: value.byAuction && typeof value.byAuction === 'object' ? value.byAuction : {},
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export async function loadAuctionBidsMap(): Promise<Record<string, AuctionBid[]>> {
  if (!hasDatabaseUrl()) return {};
  try {
    return await elevatedTx(async (tx) => (await readStore(tx)).byAuction);
  } catch {
    return {};
  }
}

export async function loadAuctionBids(auctionId: string): Promise<AuctionBid[]> {
  const map = await loadAuctionBidsMap();
  return map[auctionId] ?? [];
}

export async function placeAuctionBid(input: {
  auctionId: string;
  amount: number;
  bidderName: string;
  minAmount: number;
}): Promise<{ ok: true; bid: AuctionBid } | { ok: false; error: string }> {
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (amount < input.minAmount) {
    return { ok: false, error: 'bid_too_low' };
  }
  const name = input.bidderName.trim().slice(0, 80) || 'Bidder';
  const bid: AuctionBid = {
    id: `bid-${randomUUID().slice(0, 8)}`,
    amount,
    bidderName: name,
    createdAt: new Date().toISOString(),
  };

  if (!hasDatabaseUrl()) {
    return { ok: true, bid };
  }

  try {
    await elevatedTx(async (tx) => {
      const store = await readStore(tx);
      const existing = store.byAuction[input.auctionId] ?? [];
      const next: BidsStore = {
        byAuction: {
          ...store.byAuction,
          [input.auctionId]: [bid, ...existing].slice(0, 50),
        },
        updatedAt: new Date().toISOString(),
      };
      await tx
        .insert(platformSettings)
        .values({
          key: BIDS_KEY,
          value: next,
          updatedByUserId: null,
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: next,
            updatedAt: new Date(),
            updatedByUserId: null,
          },
        });
    });
    return { ok: true, bid };
  } catch {
    return { ok: false, error: 'persist_failed' };
  }
}
