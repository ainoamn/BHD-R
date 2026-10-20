import { describe, expect, it } from 'vitest';
import {
  isTenantSoftBasePath,
  tenantPathForView,
  tenantSoftViewFromPath,
} from '@/lib/tenant-soft-nav';

describe('tenant soft nav', () => {
  it('maps section paths to views', () => {
    expect(tenantSoftViewFromPath('/ar/tenant')).toBe('overview');
    expect(tenantSoftViewFromPath('/tenant')).toBe('overview');
    expect(tenantSoftViewFromPath('/ar/tenant/reservations')).toBe('bookings');
    expect(tenantSoftViewFromPath('/tenant/contracts')).toBe('contracts');
    expect(tenantSoftViewFromPath('/tenant/leases')).toBe('leases');
    expect(tenantSoftViewFromPath('/tenant/invoices')).toBe('invoices');
    expect(tenantSoftViewFromPath('/tenant/payments')).toBe('payments');
    expect(tenantSoftViewFromPath('/tenant/requests')).toBe('requests');
  });

  it('ignores detail routes', () => {
    expect(tenantSoftViewFromPath('/tenant/contracts/abc')).toBeNull();
    expect(tenantSoftViewFromPath('/tenant/reservations/abc')).toBeNull();
    expect(tenantSoftViewFromPath('/tenant/maintenance')).toBeNull();
  });

  it('recognizes soft sidebar base paths', () => {
    expect(isTenantSoftBasePath('')).toBe(true);
    expect(isTenantSoftBasePath('/reservations')).toBe(true);
    expect(isTenantSoftBasePath('/maintenance')).toBe(false);
  });

  it('round-trips view paths', () => {
    expect(tenantPathForView('overview')).toBe('/tenant');
    expect(tenantPathForView('bookings')).toBe('/tenant/reservations');
    expect(tenantSoftViewFromPath(tenantPathForView('invoices'))).toBe('invoices');
  });
});
