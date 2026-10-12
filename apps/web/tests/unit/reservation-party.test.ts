import { describe, expect, it } from 'vitest';
import {
  parseReservationParty,
  partyToLeaseTenant,
  reservationPartyError,
  type ReservationParty,
} from '@/lib/reservation-party';
import {
  isInternationalPhone,
  joinPhone,
  splitPhone,
  toInternationalPhone,
} from '@/lib/world-countries';

const TODAY = '2026-10-12';

function person(patch: Partial<NonNullable<ReservationParty['person']>> = {}): ReservationParty {
  return {
    contractType: 'residential',
    termMonths: 12,
    holder: 'self',
    entityType: 'person',
    person: {
      nameAr: 'محمد سالم',
      nameEn: 'Mohammed Salim',
      nationality: 'OM',
      civilId: '12345678',
      passport: '',
      phone: '+96891234567',
      altPhone: '+96899887766',
      email: 'm@example.com',
      ...patch,
    },
    company: null,
  };
}

function company(crExpiry: string, signingMode: 'single' | 'joint' = 'single'): ReservationParty {
  return {
    contractType: 'commercial',
    termMonths: 24,
    holder: 'other',
    entityType: 'company',
    person: null,
    company: {
      nameAr: 'شركة النور ش.م.م',
      nameEn: 'Al Noor LLC',
      crNumber: '1234567',
      crIssuedOn: '2020-01-01',
      crExpiry,
      email: 'info@alnoor.om',
      phone: '+96824000000',
      altPhone: '+96891000000',
      crAddress: 'مسقط، الخوير',
      activity: 'مكتب إداري',
      signingMode,
      signatories: [{ name: 'سالم', civilId: '1111', phone: '+96892000000' }],
    },
  };
}

const rent = { mode: 'rent' as const, minMonths: 12, today: TODAY };

describe('reservation party rules', () => {
  it('accepts a complete Omani individual without a passport', () => {
    expect(parseReservationParty(person())).not.toBeNull();
    expect(reservationPartyError(person(), rent)).toBeNull();
  });

  it('requires a passport for non-Omanis', () => {
    expect(reservationPartyError(person({ nationality: 'IN' }), rent)).toBe('passport_required');
    expect(
      reservationPartyError(person({ nationality: 'IN', passport: 'P1234567' }), rent),
    ).toBeNull();
  });

  it('enforces the owner minimum term', () => {
    expect(reservationPartyError({ ...person(), termMonths: 6 }, rent)).toBe('term_too_short');
    expect(
      reservationPartyError({ ...person(), termMonths: 6 }, { ...rent, minMonths: 6 }),
    ).toBeNull();
  });

  it('rejects an expired or soon-expiring commercial registration', () => {
    expect(reservationPartyError(company('2026-10-01'), rent)).toBe('cr_expired');
    expect(reservationPartyError(company('2026-11-30'), rent)).toBe('cr_expiring_soon');
    expect(reservationPartyError(company('2027-06-30'), rent)).toBeNull();
  });

  it('needs at least two people for joint signing', () => {
    expect(reservationPartyError(company('2027-06-30', 'joint'), rent)).toBe(
      'tenant_details_invalid',
    );
  });

  it('maps a company to the lease contract tenant', () => {
    const tenant = partyToLeaseTenant(company('2027-06-30'));
    expect(tenant).toMatchObject({
      entityType: 'company',
      nameAr: 'شركة النور ش.م.م',
      crNumber: '1234567',
      signatoryName: 'سالم',
    });
  });
});

describe('international phone helpers', () => {
  it('joins and splits E.164 numbers', () => {
    expect(joinPhone('968', '091234567')).toBe('+96891234567');
    expect(splitPhone('+447700900123')).toEqual({ dial: '44', local: '7700900123' });
    expect(isInternationalPhone('+96891234567')).toBe(true);
    expect(isInternationalPhone('91234567')).toBe(false);
  });

  it('upgrades old local numbers to E.164', () => {
    expect(toInternationalPhone('91234567')).toBe('+96891234567');
    expect(toInternationalPhone('0096891234567')).toBe('+96891234567');
    expect(toInternationalPhone('96891234567')).toBe('+96891234567');
  });
});
