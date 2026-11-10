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
  /** Leases ended or terminated (or past end date). */
  expiredContracts?: number | null;
  /** Distinct tenants on active leases. */
  tenants?: number | null;
  /** Overdue invoices count. */
  arrears?: number | null;
  /** Open legal cases (not settled/closed/cancelled). */
  legalCases?: number | null;
  properties?: number | null;
  units?: number | null;
  activeLeases?: number | null;
  vacantUnits?: number | null;
  openInvoices?: number | null;
  alerts?: Array<{
    severity: 'danger' | 'warning' | 'info';
    code: string;
    count: number;
    /** Optional party/property id the alert points at. */
    resourceId?: string;
  }>;
  generatedAt?: string;
  recentActivity: Array<{
    id: string;
    title: string;
    occurredAt: string;
    status?: string;
    resourceType?: string;
    resourceId?: string;
  }>;
}

export interface UnitOption {
  id: string;
  label: string;
}
