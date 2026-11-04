import { describe, expect, it } from 'vitest';
import {
  civilIdExpiryBlocksRent,
  civilIdExpiryWarnsRent,
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
      emailVerified: true,
      civilIdExpiresOn: '2027-06-30',
      civilIdCopy: {
        name: 'id.jpg',
        mime: 'image/jpeg',
        size: 12,
      },
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
      emailVerified: true,
      crCopy: {
        name: 'cr.pdf',
        mime: 'application/pdf',
        size: 12,
      },
      signatories: [
        {
          name: 'سالم',
          civilId: '1111',
          phone: '+96892000000',
          nationality: 'OM',
          civilIdExpiresOn: '2027-06-30',
          civilIdCopy: {
            name: 'sig-id.jpg',
            mime: 'image/jpeg',
            size: 12,
          },
        },
      ],
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
      reservationPartyError(
        person({
          nationality: 'IN',
          passport: 'P1234567',
          passportExpiresOn: '2027-06-30',
          passportCopy: {
            name: 'passport.jpg',
            mime: 'image/jpeg',
            size: 12,
          },
        }),
        rent,
      ),
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

  it('blocks rent when the civil ID expires in under 30 days', () => {
    const complete = (expiresOn: string) =>
      person({
        emailVerified: true,
        civilIdExpiresOn: expiresOn,
        civilIdCopy: {
          name: 'id.jpg',
          mime: 'image/jpeg',
          size: 12,
        },
      });
    expect(reservationPartyError(complete('2026-10-20'), rent)).toBe('civil_id_expiring_soon');
    expect(reservationPartyError(complete('2026-11-10'), rent)).toBe('civil_id_expiring_soon');
    expect(reservationPartyError(complete('2026-11-11'), rent)).toBeNull();
    expect(reservationPartyError(complete('2026-12-01'), rent)).toBeNull();
  });

  it('warns (without blocking) when civil ID validity is under 90 days', () => {
    expect(civilIdExpiryBlocksRent('2026-11-11', TODAY)).toBe(false);
    expect(civilIdExpiryWarnsRent('2026-11-11', TODAY)).toBe(true);
    expect(civilIdExpiryWarnsRent('2027-01-09', TODAY)).toBe(true);
    expect(civilIdExpiryWarnsRent('2027-01-10', TODAY)).toBe(false);
    expect(civilIdExpiryBlocksRent('2026-11-10', TODAY)).toBe(true);
    expect(civilIdExpiryWarnsRent('2026-11-10', TODAY)).toBe(false);
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
