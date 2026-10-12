import { describe, expect, it } from 'vitest';
import {
  contractCategory,
  contractState,
  contractTerm,
  contractValidity,
  muscatToday,
  propertyUsage,
  rowContractCategory,
} from '../../src/lib/contract-list-facets';

const lease = (startsOn: string, endsOn: string) =>
  contractTerm({ contractType: 'lease', sourceType: 'manual', stayType: null, startsOn, endsOn });

describe('contract list facets', () => {
  it('derives the contract term', () => {
    expect(
      contractTerm({
        contractType: 'lease',
        sourceType: 'stay_booking',
        stayType: 'overnight_only',
        startsOn: '2026-10-08',
        endsOn: '2026-10-09',
      }),
    ).toBe('daily');
    expect(
      contractTerm({
        contractType: 'sale',
        sourceType: 'manual',
        stayType: null,
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
      }),
    ).toBe('sale');
    expect(lease('2026-01-01', '2026-12-31')).toBe('yearly');
    expect(lease('2026-01-01', '2027-12-31')).toBe('yearly');
    expect(lease('2026-01-01', '2026-12-28')).toBe('yearly');
    expect(lease('2026-01-01', '2026-06-30')).toBe('monthly');
    expect(lease('2026-01-01', '2026-01-31')).toBe('monthly');
    expect(
      contractTerm({
        contractType: 'lease',
        sourceType: 'manual',
        stayType: null,
        startsOn: null,
        endsOn: null,
      }),
    ).toBeNull();
  });

  it('prefers the declared use, then the property category', () => {
    expect(propertyUsage({ usageType: 'commercial', category: 'apartment' })).toBe('commercial');
    expect(propertyUsage({ usageType: null, category: 'villa' })).toBe('residential');
    expect(propertyUsage({ usageType: null, category: 'shop' })).toBe('commercial');
    expect(propertyUsage({ usageType: null, category: 'warehouse' })).toBe('industrial');
    expect(propertyUsage({ usageType: null, category: 'land' })).toBe('agricultural');
    expect(propertyUsage({ usageType: null, category: 'other' })).toBeNull();
  });

  it('tells whether the term is in force on a day', () => {
    expect(contractValidity('2026-10-01', '2026-10-31', '2026-10-12')).toBe('current');
    expect(contractValidity('2026-10-12', '2026-10-12', '2026-10-12')).toBe('current');
    expect(contractValidity('2026-11-01', '2026-11-30', '2026-10-12')).toBe('upcoming');
    expect(contractValidity('2026-10-08', '2026-10-09', '2026-10-12')).toBe('ended');
    expect(contractValidity(null, '2026-10-09', '2026-10-12')).toBeNull();
  });

  it('sorts contracts into the sidebar kinds', () => {
    const category = (contractType: string | null, sourceType: string | null, stayType = null) =>
      contractCategory({ contractType, sourceType, stayType });
    expect(category('sale', 'manual')).toBe('sale');
    expect(category('purchase', 'manual')).toBe('purchase');
    expect(category('lease', 'stay_booking')).toBe('daily');
    expect(category('lease', 'manual')).toBe('long_term');
    expect(category(null, 'reservation')).toBe('long_term');
    expect(rowContractCategory(undefined, 'daily')).toBe('daily');
    expect(rowContractCategory(undefined, 'sale')).toBe('sale');
    expect(rowContractCategory(undefined, 'yearly')).toBe('long_term');
    expect(rowContractCategory('purchase', 'sale')).toBe('purchase');
  });

  it('gives each contract one of four statuses', () => {
    const today = '2026-10-12';
    const state = (status: string, endsOn: string | null, linkedStatus: string | null = null) =>
      contractState({ status, endsOn, linkedStatus, today });
    expect(state('signed', '2026-12-31')).toBe('active');
    expect(state('signed', '2026-10-12')).toBe('active');
    expect(state('signed', null)).toBe('active');
    expect(state('signed', '2026-10-11')).toBe('ended');
    expect(state('signed', '2026-12-31', 'checked_out')).toBe('ended');
    expect(state('signed', '2027-12-31', 'terminated')).toBe('ended');
    expect(state('void', '2026-12-31')).toBe('cancelled');
    expect(state('terminated', '2026-12-31')).toBe('cancelled');
    expect(state('signed', '2026-12-31', 'cancelled')).toBe('cancelled');
    expect(state('sent', '2026-12-31', 'expired')).toBe('cancelled');
    expect(state('draft', '2026-12-31')).toBe('pending');
    expect(state('sent', '2026-12-31')).toBe('pending');
    expect(state('partially_signed', '2026-10-01')).toBe('pending');
  });

  it('reads today in Muscat', () => {
    expect(muscatToday(new Date('2026-10-12T21:30:00Z'))).toBe('2026-10-13');
  });
});
