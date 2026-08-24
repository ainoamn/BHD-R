export type {
  ListingCollection,
  PublicListing,
  PublicPropertyDetail,
  PublicUnitDetail,
} from '@bhd-r/contracts';

export type PortalRole = 'platform' | 'owner' | 'developer' | 'tenant';

export interface Viewer {
  id: string;
  username?: string | null;
  email?: string;
  displayName: string;
  partyId: string | null;
  locale: 'ar' | 'en';
  organizationId: string | null;
  roles: string[];
  portals: PortalRole[];
  permissions: string[];
}

export interface PortalOverview {
  occupancyPercent: number | null;
  collected: Array<{ currency: string; amountMinor: string }>;
  collectedMinor?: string | null;
  currency?: string;
  openTickets: number | null;
  expiringContracts: number | null;
  recentActivity: Array<{ id: string; title: string; occurredAt: string; status?: string }>;
}

export interface UnitOption {
  id: string;
  label: string;
}
