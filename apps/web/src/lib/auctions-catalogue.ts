/**
 * Public real-estate auctions catalogue (ported from Ain Oman UX, BHD R branded).
 * Seed list is live-ready; bid overlays persist via platform_settings when Neon is available.
 */

export type AuctionStatus = 'active' | 'upcoming' | 'ended';

export type AuctionBid = {
  id: string;
  amount: number;
  bidderName: string;
  createdAt: string;
};

export type AuctionListing = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  locationAr: string;
  locationEn: string;
  startingPrice: number;
  currentBid: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  /** Offset hours from “now” when catalogue is loaded — resolved at runtime */
  startOffsetHours: number;
  endOffsetHours: number;
  image: string;
  featuresAr: string[];
  featuresEn: string[];
  auctionTypeAr: string;
  auctionTypeEn: string;
  coords: { lat: number; lng: number };
  featured?: boolean;
  /** Base status hint; runtime status may override from clocks */
  status: AuctionStatus;
};

export type ResolvedAuction = Omit<
  AuctionListing,
  'startOffsetHours' | 'endOffsetHours' | 'status' | 'featured'
> & {
  featured: boolean;
  startTime: number;
  endTime: number;
  status: AuctionStatus;
  bids: AuctionBid[];
};

/** Relative schedule seeds — keep auctions looking live across deploys. */
export const AUCTIONS_CATALOGUE: AuctionListing[] = [
  {
    id: 'auc-sea-view',
    titleAr: 'شقة راقية بإطلالة بحرية',
    titleEn: 'Sea-view apartment',
    descriptionAr: 'شقة 180 م² بإطلالة مباشرة على البحر في القرم، تشطيب فاخر وموقفين.',
    descriptionEn: '180 m² apartment with direct sea views in Qurum — premium finish, two parking spaces.',
    locationAr: 'مسقط، شاطئ القرم',
    locationEn: 'Muscat, Qurum Beach',
    startingPrice: 98000,
    currentBid: 105000,
    area: 180,
    bedrooms: 3,
    bathrooms: 2,
    startOffsetHours: -24,
    endOffsetHours: 36,
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['إطلالة بحرية', 'صالة رياضية', 'مواقف'],
    featuresEn: ['Sea view', 'Gym', 'Parking'],
    auctionTypeAr: 'مزاد إلكتروني',
    auctionTypeEn: 'Online auction',
    coords: { lat: 23.6139, lng: 58.5334 },
    featured: true,
    status: 'active',
  },
  {
    id: 'auc-hotel-apt',
    titleAr: 'شقة فندقية فاخرة',
    titleEn: 'Luxury hotel apartment',
    descriptionAr: 'وحدة فندقية مخدومة في قلب العاصمة مع خدمات ضيافة.',
    descriptionEn: 'Serviced hotel unit in the capital with hospitality amenities.',
    locationAr: 'مسقط، الخوير',
    locationEn: 'Muscat, Al Khuwair',
    startingPrice: 75000,
    currentBid: 82000,
    area: 95,
    bedrooms: 1,
    bathrooms: 1,
    startOffsetHours: -12,
    endOffsetHours: 48,
    image: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['مخدومة', 'أمن 24/7'],
    featuresEn: ['Serviced', '24/7 security'],
    auctionTypeAr: 'مزاد إلكتروني',
    auctionTypeEn: 'Online auction',
    coords: { lat: 23.588, lng: 58.3829 },
    featured: true,
    status: 'active',
  },
  {
    id: 'auc-land-800',
    titleAr: 'أرض سكنية مميزة',
    titleEn: 'Prime residential plot',
    descriptionAr: 'أرض 800 م² على شارع رئيسي، جاهزة للبناء.',
    descriptionEn: '800 m² plot on a main road — ready to build.',
    locationAr: 'مسقط، المعبيلة',
    locationEn: 'Muscat, Al Mawaleh',
    startingPrice: 45000,
    currentBid: 48000,
    area: 800,
    bedrooms: 0,
    bathrooms: 0,
    startOffsetHours: -6,
    endOffsetHours: 72,
    image: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['شارع رئيسي', 'صك ساري'],
    featuresEn: ['Main road', 'Valid title'],
    auctionTypeAr: 'مزاد علني',
    auctionTypeEn: 'Public auction',
    coords: { lat: 23.65, lng: 58.15 },
    featured: false,
    status: 'active',
  },
  {
    id: 'auc-villa-embassy',
    titleAr: 'فيلا فاخرة في حي السفارات',
    titleEn: 'Luxury villa in Embassy district',
    descriptionAr: 'فيلا 450 م² مع مسبح وحديقة ومواقف متعددة.',
    descriptionEn: '450 m² villa with pool, garden and multiple parking spaces.',
    locationAr: 'مسقط، الخوض',
    locationEn: 'Muscat, Al Khoud',
    startingPrice: 225000,
    currentBid: 225000,
    area: 450,
    bedrooms: 5,
    bathrooms: 4,
    startOffsetHours: 24,
    endOffsetHours: 96,
    image: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['مسبح', 'حديقة', 'مواقف'],
    featuresEn: ['Pool', 'Garden', 'Parking'],
    auctionTypeAr: 'مزاد علني',
    auctionTypeEn: 'Public auction',
    coords: { lat: 23.6005, lng: 58.1606 },
    featured: true,
    status: 'upcoming',
  },
  {
    id: 'auc-farm',
    titleAr: 'مزرعة حديثة',
    titleEn: 'Modern farm',
    descriptionAr: 'مزرعة مجهزة بنظام ري وآبار في الباطنة.',
    descriptionEn: 'Farm with irrigation and wells in Al Batinah.',
    locationAr: 'صحار',
    locationEn: 'Sohar',
    startingPrice: 95000,
    currentBid: 95000,
    area: 12000,
    bedrooms: 2,
    bathrooms: 2,
    startOffsetHours: 48,
    endOffsetHours: 168,
    image: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['ري', 'آبار'],
    featuresEn: ['Irrigation', 'Wells'],
    auctionTypeAr: 'مزاد إلكتروني',
    auctionTypeEn: 'Online auction',
    coords: { lat: 24.3461, lng: 56.7075 },
    featured: false,
    status: 'upcoming',
  },
  {
    id: 'auc-palace',
    titleAr: 'قصر فخم',
    titleEn: 'Grand palace residence',
    descriptionAr: 'مزاد منتهٍ — قصر بمساحة واسعة في منطقة راقية.',
    descriptionEn: 'Ended auction — grand residence in a premium area.',
    locationAr: 'مسقط، القرم',
    locationEn: 'Muscat, Qurum',
    startingPrice: 480000,
    currentBid: 512000,
    area: 900,
    bedrooms: 8,
    bathrooms: 7,
    startOffsetHours: -240,
    endOffsetHours: -24,
    image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['حديقة واسعة', 'مجلس'],
    featuresEn: ['Large garden', 'Majlis'],
    auctionTypeAr: 'مزاد علني',
    auctionTypeEn: 'Public auction',
    coords: { lat: 23.61, lng: 58.49 },
    featured: true,
    status: 'ended',
  },
  {
    id: 'auc-beach-house',
    titleAr: 'بيت شاطئي',
    titleEn: 'Beach house',
    descriptionAr: 'مزاد منتهٍ — بيت شاطئي في صلالة.',
    descriptionEn: 'Ended auction — beach house in Salalah.',
    locationAr: 'صلالة',
    locationEn: 'Salalah',
    startingPrice: 140000,
    currentBid: 155000,
    area: 220,
    bedrooms: 4,
    bathrooms: 3,
    startOffsetHours: -200,
    endOffsetHours: -48,
    image: 'https://images.unsplash.com/photo-1499793983690-e8b21efc77d0?auto=format&fit=crop&w=1470&q=80',
    featuresAr: ['شاطئ', 'تراس'],
    featuresEn: ['Beach', 'Terrace'],
    auctionTypeAr: 'مزاد إلكتروني',
    auctionTypeEn: 'Online auction',
    coords: { lat: 17.0151, lng: 54.0924 },
    featured: false,
    status: 'ended',
  },
];

function resolveStatus(startTime: number, endTime: number, now: number): AuctionStatus {
  if (now < startTime) return 'upcoming';
  if (now >= endTime) return 'ended';
  return 'active';
}

export function resolveAuction(
  listing: AuctionListing,
  now = Date.now(),
  extraBids: AuctionBid[] = [],
): ResolvedAuction {
  // Re-anchor from a stable day bucket so SSR/client stay close
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const start = day + listing.startOffsetHours * 3600_000;
  const end = day + listing.endOffsetHours * 3600_000;
  const bids = [...extraBids].sort((a, b) => b.amount - a.amount);
  const topBid = bids[0]?.amount;
  const currentBid = Math.max(listing.currentBid, topBid ?? 0);
  return {
    id: listing.id,
    titleAr: listing.titleAr,
    titleEn: listing.titleEn,
    descriptionAr: listing.descriptionAr,
    descriptionEn: listing.descriptionEn,
    locationAr: listing.locationAr,
    locationEn: listing.locationEn,
    startingPrice: listing.startingPrice,
    currentBid,
    area: listing.area,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    image: listing.image,
    featuresAr: listing.featuresAr,
    featuresEn: listing.featuresEn,
    auctionTypeAr: listing.auctionTypeAr,
    auctionTypeEn: listing.auctionTypeEn,
    coords: listing.coords,
    featured: Boolean(listing.featured),
    startTime: start,
    endTime: end,
    status: resolveStatus(start, end, now),
    bids,
  };
}

export function listResolvedAuctions(
  now = Date.now(),
  bidsByAuction: Record<string, AuctionBid[]> = {},
): ResolvedAuction[] {
  return AUCTIONS_CATALOGUE.map((item) => resolveAuction(item, now, bidsByAuction[item.id] ?? []));
}

export function getResolvedAuction(
  id: string,
  now = Date.now(),
  extraBids: AuctionBid[] = [],
): ResolvedAuction | null {
  const listing = AUCTIONS_CATALOGUE.find((item) => item.id === id);
  if (!listing) return null;
  return resolveAuction(listing, now, extraBids);
}

export function formatOmr(amount: number, locale: 'ar' | 'en'): string {
  const n = new Intl.NumberFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
    maximumFractionDigits: 0,
  }).format(amount);
  return locale === 'ar' ? `${n} ر.ع` : `OMR ${n}`;
}

export function remainingParts(endTime: number, now = Date.now()) {
  const ms = Math.max(0, endTime - now);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return { days, hours, minutes, seconds, ended: ms <= 0 };
}
