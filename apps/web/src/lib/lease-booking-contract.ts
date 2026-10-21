import 'server-only';
import { createHash } from 'node:crypto';
import { formatMoney } from '@/lib/format';
import { bookingTermsDocument, termsBlocksFromStored } from '@/lib/booking-terms';
import type { ContractDocument } from '@/lib/contract-document';
import { partyToLeaseTenant } from '@/lib/reservation-party';
import type { loadLeaseBookingAgreement } from '@/lib/public-lease-booking-neon';
import type { ContractArticleHead } from '@/components/contract-document-view';

export type LeaseBookingAgreement = NonNullable<
  Awaited<ReturnType<typeof loadLeaseBookingAgreement>>
>;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function leaseContractTitle(mode: 'rent' | 'sale') {
  return mode === 'sale'
    ? { ar: 'اتفاقية حجز عقار للشراء', en: 'Purchase Reservation Agreement' }
    : { ar: 'اتفاقية حجز وحدة للإيجار', en: 'Rental Reservation Agreement' };
}

/**
 * The reservation as an official document in the shared contract layout, so the customer
 * reads and signs the same design the landlord sees on contracts.
 */
export function leaseBookingAgreement(booking: LeaseBookingAgreement): {
  head: ContractArticleHead;
  doc: ContractDocument;
} {
  const sale = booking.mode === 'sale';
  const priceMinor = sale ? booking.salePriceMinor : booking.rentMinor;
  const money = (amountMinor: string | null) =>
    amountMinor && amountMinor !== '0' ? { amountMinor, currency: booking.currency } : null;
  const signature = booking.signature;
  const ownerName = booking.owner?.displayName ?? '—';
  const premises = booking.premises;
  const partyCard = booking.party ? partyToLeaseTenant(booking.party) : null;
  const tenantName = partyCard?.nameAr || booking.contact.fullName;

  const head: ContractArticleHead = {
    reference: booking.referenceCode,
    kind: 'initial',
    status: signature ? 'signed' : 'sent',
    startsOn: '',
    endsOn: '',
    documentUrl: null,
    documentHash: null,
    parties: {
      owner: { id: '', displayName: ownerName },
      tenant: { id: '', displayName: tenantName },
    },
    property: { id: '', nameAr: booking.propertyNameAr, nameEn: booking.propertyNameEn },
    unit: {
      id: booking.unitId,
      code: booking.unitCode,
      nameAr: booking.unitNameAr,
      nameEn: booking.unitNameEn,
    },
  };

  const doc: ContractDocument = {
    type: sale ? 'sale' : 'lease',
    createdAt: booking.capturedAt,
    sentAt: null,
    completedAt: null,
    template: { ar: null, en: null },
    letterhead: booking.letterhead,
    amount: money(priceMinor),
    deposit: null,
    stayType: null,
    checkInTime: null,
    checkOutTime: null,
    source: {
      type: 'lease_reservation',
      referenceCode: booking.referenceCode,
      stayBookingId: null,
    },
    approval: null,
    tenantContact: { email: booking.contact.email, phone: booking.contact.phone },
    owner: booking.owner
      ? {
          name: booking.owner.displayName,
          entityType: booking.owner.type === 'company' ? 'company' : 'person',
          civilId: null,
          passport: null,
          nationality: null,
          crNumber: null,
          signatoryName: null,
          signatoryCivilId: null,
          phone: booking.owner.phone,
          email: booking.owner.email,
        }
      : null,
    tenant: partyCard
      ? {
          name: partyCard.nameAr,
          entityType: partyCard.entityType,
          civilId: partyCard.civilId || null,
          passport: partyCard.passport || null,
          nationality: partyCard.nationality || null,
          crNumber: partyCard.crNumber || null,
          signatoryName: partyCard.signatoryName || null,
          signatoryCivilId: partyCard.signatoryCivilId || null,
          phone: partyCard.phone,
          email: partyCard.email,
        }
      : {
          name: booking.contact.fullName,
          entityType: 'person',
          civilId: null,
          passport: null,
          nationality: null,
          crNumber: null,
          signatoryName: null,
          signatoryCivilId: null,
          phone: booking.contact.phone,
          email: booking.contact.email,
        },
    premises: premises
      ? {
          propertyNameAr: premises.propertyNameAr,
          propertyNameEn: premises.propertyNameEn,
          kind: premises.kind,
          category: premises.category,
          serialNumber: premises.serialNumber,
          governorate: premises.governorate,
          wilayat: premises.wilayat,
          city: premises.city,
          area: premises.area,
          street: premises.street,
          buildingNumber: premises.buildingNumber,
          postalCode: premises.postalCode,
          deedNumber: premises.deedNumber,
          plotNumber: premises.plotNumber,
          furnishing: premises.furnishing,
          parkingSpaces: premises.parkingSpaces,
          builtUpArea: premises.builtUpArea,
          floorsCount: premises.floorsCount,
          yearBuilt: premises.yearBuilt,
          unit: {
            code: booking.unitCode,
            nameAr: booking.unitNameAr,
            nameEn: booking.unitNameEn,
            floor: premises.unitFloor,
            bedrooms: premises.unitBedrooms,
            bathrooms: premises.unitBathrooms,
            majlis: premises.unitMajlis,
            halls: premises.unitHalls,
            kitchens: premises.unitKitchens,
            hasPool: premises.unitHasPool,
            areaSquareMeters: premises.unitAreaSquareMeters,
          },
        }
      : null,
    location: booking.location,
    terms: bookingTermsDocument({
      mode: booking.mode,
      depositAr: formatMoney(booking.depositMinor, booking.currency, 'ar'),
      depositEn: formatMoney(booking.depositMinor, booking.currency, 'en'),
      blocks: booking.ownerTerms ? termsBlocksFromStored(booking.ownerTerms) : null,
    }),
    termsAcceptedAt: booking.termsAcceptedAt,
    signatures: signature
      ? [
          {
            id: booking.reservationId,
            role: sale ? 'buyer' : 'tenant',
            method: 'reservation_esign',
            name: booking.contact.fullName,
            email: booking.contact.email,
            signedAt: signature.signedAt,
            hash: createHash('sha256')
              .update([booking.referenceCode, signature.signedAt, signature.png ?? ''].join('|'))
              .digest('hex'),
            serial: signature.serial,
          },
        ]
      : [],
    verification: null,
    files: signature?.png ? [{ kind: 'signature', signedAt: signature.signedAt }] : [],
    stay: null,
    addenda: [],
    parent: null,
    annexes: [],
    reservation: {
      mode: booking.mode,
      depositPaid: money(booking.depositMinor),
      paidAt: booking.depositPaidAt,
      reservedUntil: booking.reservedUntil,
    },
  };

  return { head, doc };
}
