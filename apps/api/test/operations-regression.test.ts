import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createPropertySchema, createUnitSchema } from '@bhd-r/contracts';
import { validateBalanced } from '../src/accounting/accounting.service.js';
import { assertTransition, salesTransitions } from '../src/operations/operations.service.js';
import {
  assertRenewalTerms,
  assertReservationRequirementsApproved,
} from '../src/leasing/leasing.service.js';

describe('financial accounting invariants', () => {
  it('balances with exact integer minor units instead of floating point arithmetic', () => {
    expect(() =>
      validateBalanced([
        {
          accountId: 'cash',
          debitMinor: '9007199254740993001',
          creditMinor: '0',
          currency: 'OMR',
        },
        {
          accountId: 'revenue',
          debitMinor: '0',
          creditMinor: '9007199254740993001',
          currency: 'OMR',
        },
      ]),
    ).not.toThrow();
  });

  it('rejects unbalanced or two-sided journal lines', () => {
    expect(() =>
      validateBalanced([
        { accountId: 'cash', debitMinor: '1000', creditMinor: '0', currency: 'OMR' },
        { accountId: 'revenue', debitMinor: '0', creditMinor: '999', currency: 'OMR' },
      ]),
    ).toThrow(ConflictException);
    expect(() =>
      validateBalanced([
        { accountId: 'cash', debitMinor: '1', creditMinor: '1', currency: 'OMR' },
        { accountId: 'revenue', debitMinor: '0', creditMinor: '1', currency: 'OMR' },
      ]),
    ).toThrow(ConflictException);
  });
});

describe('workflow transition invariants', () => {
  it('permits the designed sales path and blocks reopening a won deal', () => {
    expect(() => assertTransition('lead', 'qualified', salesTransitions)).not.toThrow();
    expect(() => assertTransition('contracting', 'closed_won', salesTransitions)).not.toThrow();
    expect(() => assertTransition('closed_won', 'lead', salesTransitions)).toThrow(
      ConflictException,
    );
  });
});

describe('reservation compliance gate', () => {
  it('blocks contract conversion until every required item is approved or waived', () => {
    expect(() =>
      assertReservationRequirementsApproved([{ status: 'approved' }, { status: 'waived' }]),
    ).not.toThrow();
    expect(() =>
      assertReservationRequirementsApproved([{ status: 'approved' }, { status: 'submitted' }]),
    ).toThrow(ConflictException);
    expect(() => assertReservationRequirementsApproved([{ status: 'rejected' }])).toThrow(
      ConflictException,
    );
    expect(() => assertReservationRequirementsApproved([])).toThrow(ConflictException);
  });
});

describe('signed lease renewal invariants', () => {
  it('requires a later end date and preserves the original currency', () => {
    const current = { endsOn: '2027-12-31', currency: 'OMR' };
    expect(() =>
      assertRenewalTerms(current, { endsOn: '2028-12-31', currency: 'OMR' }),
    ).not.toThrow();
    expect(() => assertRenewalTerms(current, { endsOn: '2027-12-31', currency: 'OMR' })).toThrow(
      ConflictException,
    );
    expect(() => assertRenewalTerms(current, { endsOn: '2028-12-31', currency: 'USD' })).toThrow(
      ConflictException,
    );
  });
});

describe('complete property intake contract', () => {
  it('validates registry, facilities, meters and sale/rent information', () => {
    const property = createPropertySchema.parse({
      organizationId: '00000000-0000-4000-8000-000000000001',
      ownerPartyId: '00000000-0000-4000-8000-000000000002',
      kind: 'multi_unit',
      category: 'building',
      nameAr: 'دار القرم',
      nameEn: 'Qurum Residence',
      address: { countryCode: 'OM', governorate: 'Muscat', wilayat: 'Bawshar', city: 'Muscat' },
      defaultCurrency: 'OMR',
      profile: {
        deedNumber: 'D-88',
        yearBuilt: 2024,
        managementFee: { amountMinor: '25000', currency: 'OMR' },
      },
      amenities: [{ code: 'cctv', labelAr: 'كاميرات', labelEn: 'CCTV' }],
      meters: [{ utilityType: 'electricity', meterNumber: 'E-991' }],
      documents: [{ documentType: 'title_deed', documentNumber: 'D-88' }],
    });
    const unit = createUnitSchema.parse({
      propertyId: '00000000-0000-4000-8000-000000000003',
      code: 'U-01',
      nameAr: 'الوحدة الأولى',
      nameEn: 'Unit 01',
      listingPurpose: 'both',
      rent: { amountMinor: '450000', currency: 'OMR' },
      salePrice: { amountMinor: '120000000', currency: 'OMR' },
    });
    expect(property.profile?.deedNumber).toBe('D-88');
    expect(property.amenities).toHaveLength(1);
    expect(unit.listingPurpose).toBe('both');
  });
});
