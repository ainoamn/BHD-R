import { describe, expect, it } from 'vitest';
import {
  buildTenancyAlerts,
  EMPTY_TENANCY,
  invoiceOutstandingMinor,
  tenancyContractGroups,
  type TenancyContract,
  type TenancyInvoice,
  type TenancyLease,
  type TenancyStay,
} from '@/lib/tenancy-shared';

const landlord = { organizationId: 'org-1', ar: 'المالك', en: 'Landlord' };

function contract(patch: Partial<TenancyContract>): TenancyContract {
  return {
    id: 'c1',
    landlord,
    reference: 'CTR-1',
    kind: 'initial',
    parentContractId: null,
    status: 'sent',
    tenantSigned: false,
    startsOn: '2026-11-01',
    endsOn: '2027-10-31',
    unitCode: 'A-01',
    unitAr: null,
    unitEn: null,
    amountMinor: '180000',
    currency: 'OMR',
    stayReference: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    ...patch,
  };
}

function invoice(patch: Partial<TenancyInvoice>): TenancyInvoice {
  return {
    id: 'i1',
    landlord,
    number: 'INV-1',
    status: 'issued',
    issuedOn: '2026-10-01',
    dueOn: '2026-10-20',
    totalMinor: '180000',
    paidMinor: '30000',
    currency: 'OMR',
    ...patch,
  };
}

function lease(patch: Partial<TenancyLease>): TenancyLease {
  return {
    id: 'l1',
    contractId: 'c1',
    landlord,
    status: 'active',
    startsOn: '2026-01-01',
    endsOn: '2026-11-30',
    rentMinor: '180000',
    currency: 'OMR',
    unitCode: 'A-01',
    unitAr: null,
    unitEn: null,
    fromStay: false,
    ...patch,
  };
}

function stay(patch: Partial<TenancyStay>): TenancyStay {
  return {
    id: 's1',
    referenceCode: 'ST-1',
    status: 'confirmed',
    checkInOn: '2026-10-20',
    checkOutOn: '2026-10-22',
    totalMinor: '40000',
    currency: 'OMR',
    titleAr: null,
    titleEn: null,
    canRequestDepositRefund: false,
    ...patch,
  };
}

const today = '2026-10-12';

describe('tenancy alerts', () => {
  it('asks the tenant to sign only contracts still waiting on them', () => {
    const alerts = buildTenancyAlerts(
      {
        ...EMPTY_TENANCY,
        contracts: [
          contract({ id: 'a' }),
          contract({ id: 'b', status: 'partially_signed', tenantSigned: true }),
          contract({ id: 'c', status: 'signed' }),
        ],
      },
      today,
    );
    expect(alerts.map((alert) => [alert.kind, alert.id])).toEqual([['contract_sign', 'a']]);
    expect(alerts[0]?.href).toBe('/tenant/contracts/a');
  });

  it('flags overdue invoices first and ignores invoices due later than two weeks', () => {
    const alerts = buildTenancyAlerts(
      {
        ...EMPTY_TENANCY,
        invoices: [
          invoice({ id: 'soon', dueOn: '2026-10-20' }),
          invoice({ id: 'late', dueOn: '2026-10-05' }),
          invoice({ id: 'far', dueOn: '2026-12-01' }),
          invoice({ id: 'paid', status: 'paid', dueOn: '2026-10-01' }),
        ],
        contracts: [contract({ id: 'sign' })],
      },
      today,
    );
    expect(alerts.map((alert) => `${alert.kind}:${alert.id}`)).toEqual([
      'invoice_overdue:late',
      'contract_sign:sign',
      'invoice_due:soon',
    ]);
    expect(alerts[0]?.amountMinor).toBe('150000');
  });

  it('warns about leases ending soon but not stay leases', () => {
    const alerts = buildTenancyAlerts(
      {
        ...EMPTY_TENANCY,
        leases: [
          lease({ id: 'ending' }),
          lease({ id: 'stay', fromStay: true, endsOn: '2026-10-14' }),
          lease({ id: 'later', endsOn: '2027-06-30' }),
        ],
      },
      today,
    );
    expect(alerts.map((alert) => alert.id)).toEqual(['ending']);
    expect(alerts[0]?.action).toBe(false);
  });

  it('turns stay states into actions with the guest booking link', () => {
    const alerts = buildTenancyAlerts(
      {
        ...EMPTY_TENANCY,
        stays: [
          stay({ id: 'pay', referenceCode: 'ST-PAY', status: 'payment_pending' }),
          stay({ id: 'refund', status: 'checked_out', canRequestDepositRefund: true }),
          stay({ id: 'ok' }),
        ],
      },
      today,
    );
    expect(alerts.map((alert) => alert.kind)).toEqual(['stay_payment', 'stay_refund']);
    expect(alerts[0]?.href).toBe('/guest/stays/pay?ref=ST-PAY');
  });

  it('never reports a negative outstanding amount', () => {
    expect(invoiceOutstandingMinor(invoice({ paidMinor: '200000' }))).toBe('0');
  });

  it('groups amendments under the original contract', () => {
    const root = contract({ id: 'root', reference: 'CTR-1', kind: 'initial' });
    const addendum = contract({
      id: 'add',
      reference: 'CTR-2',
      kind: 'amendment',
      parentContractId: 'root',
      createdAt: '2026-10-11T00:00:00.000Z',
    });
    const groups = tenancyContractGroups([addendum, root]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.root.id).toBe('root');
    expect(groups[0]?.attachments.map((row) => row.id)).toEqual(['add']);
  });
});
