import type { PortalRole } from '@/lib/types';

export type OperationsSection =
  | 'properties'
  | 'contacts'
  | 'requests'
  | 'bookings'
  | 'leasing'
  | 'sales'
  | 'contracts'
  | 'invoices'
  | 'payments'
  | 'accounting'
  | 'expenses'
  | 'maintenance'
  | 'work-orders'
  | 'tasks'
  | 'legal'
  | 'approvals'
  | 'reports'
  | 'team'
  | 'api-keys';

export const OPERATIONS_SECTIONS = [
  'properties',
  'contacts',
  'requests',
  'bookings',
  'leasing',
  'sales',
  'contracts',
  'invoices',
  'payments',
  'accounting',
  'expenses',
  'maintenance',
  'work-orders',
  'tasks',
  'legal',
  'approvals',
  'reports',
  'team',
  'api-keys',
] as const satisfies readonly OperationsSection[];

/** Prefer high-traffic sections first when warming the client cache. */
export const OPS_WARM_ORDER: OperationsSection[] = [
  'properties',
  'invoices',
  'contracts',
  'leasing',
  'bookings',
  'maintenance',
  'contacts',
  'payments',
  'requests',
  'sales',
  'accounting',
  'expenses',
  'work-orders',
  'tasks',
  'legal',
  'approvals',
  'reports',
  'team',
  'api-keys',
];

export type OperationsWorkspacePayload = {
  records: Record<string, unknown>[];
  summary: Record<string, unknown>;
  secondary: Record<string, unknown>[];
  context: Record<string, unknown>;
  apiOnline: boolean;
  nestConfigured: boolean;
  recordsEmpty: boolean;
  apiUnauthorized: boolean;
  dataFromDb: boolean;
  locale: 'ar' | 'en';
};

export function isOperationsSection(value: string): value is OperationsSection {
  return (OPERATIONS_SECTIONS as readonly string[]).includes(value);
}

export function opsSectionsForPortal(portal: PortalRole): OperationsSection[] {
  if (portal === 'platform') return [];
  if (portal === 'tenant') {
    return ['requests', 'contracts', 'invoices', 'payments', 'maintenance'];
  }
  return [...OPS_WARM_ORDER];
}
