import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_POLICY, sanitizeApprovalPolicy } from '@/lib/approval-policy';
import {
  approvedElectronically,
  documentsToVerify,
  leaseJourneyPhase,
  phaseWaitsOn,
  type ReservationLifecycle,
} from '@/lib/lease-reservation-lifecycle';
import { pendingApprovalTitle, type PendingApprovalItem } from '@/lib/pending-approvals-shared';

const paid = {
  status: 'confirmed',
  depositPaidAt: '2026-10-13T08:00:00.000Z',
  esignSignedAt: '2026-10-13T08:05:00.000Z',
};

describe('approval policy', () => {
  it('defaults contract and payment to auto; invalid steps fall back to defaults', () => {
    expect(sanitizeApprovalPolicy(null)).toEqual(DEFAULT_APPROVAL_POLICY);
    expect(sanitizeApprovalPolicy({ booking: 'auto', contract: 'bogus' })).toEqual({
      ...DEFAULT_APPROVAL_POLICY,
      booking: 'auto',
    });
  });
});

describe('lease journey with electronic approvals', () => {
  it('waits on the owner to confirm a reported payment before approval', () => {
    const lifecycle: ReservationLifecycle = {
      paymentReview: { status: 'pending', reportedAt: paid.depositPaidAt },
    };
    const phase = leaseJourneyPhase({ ...paid, lifecycle });
    expect(phase).toBe('awaiting_payment_review');
    expect(phaseWaitsOn(phase)).toBe('owner');
    const confirmed = leaseJourneyPhase({
      ...paid,
      lifecycle: { paymentReview: { status: 'confirmed', reportedAt: paid.depositPaidAt } },
    });
    expect(confirmed).toBe('awaiting_owner_approval');
  });

  it('lists documents the system accepted until the team verifies them', () => {
    const lifecycle: ReservationLifecycle = {
      approval: { at: paid.esignSignedAt, byUserId: null, byName: null, automatic: true },
      requirements: [
        {
          code: 'civil_id',
          labelAr: 'البطاقة',
          labelEn: 'ID',
          status: 'approved',
          autoApproved: true,
        },
        {
          code: 'passport',
          labelAr: 'الجواز',
          labelEn: 'Passport',
          status: 'approved',
          autoApproved: true,
          verifiedAt: paid.esignSignedAt,
        },
        { code: 'salary_certificate', labelAr: 'راتب', labelEn: 'Salary', status: 'approved' },
      ],
    };
    expect(approvedElectronically(lifecycle)).toBe(true);
    expect(documentsToVerify(lifecycle).map((item) => item.code)).toEqual(['civil_id']);
    expect(approvedElectronically({ requirements: [] })).toBe(false);
  });

  it('closes a booking cancelled for invalid documents even after the tenant signed', () => {
    const lifecycle: ReservationLifecycle = {
      tenantSignature: { signedAt: paid.esignSignedAt, evidenceEventId: 'e' },
      cancellation: {
        at: paid.esignSignedAt,
        byName: null,
        reason: 'documents_invalid',
        note: 'صورة غير واضحة',
      },
    };
    expect(leaseJourneyPhase({ ...paid, status: 'cancelled', lifecycle })).toBe('closed');
    expect(documentsToVerify(lifecycle)).toEqual([]);
  });

  it('reopens documents when a cheque is rejected after the tenant signed', () => {
    const lifecycle: ReservationLifecycle = {
      approval: { at: paid.esignSignedAt, byUserId: null, byName: 'Owner', automatic: true },
      contractDraft: {
        savedAt: paid.esignSignedAt,
        byName: 'Owner',
      },
      contract: {
        id: 'c1',
        reference: 'L-1',
        issuedAt: paid.esignSignedAt,
        byName: 'Owner',
        automatic: true,
      },
      tenantSignature: { signedAt: paid.esignSignedAt, evidenceEventId: 'e' },
      chequeInstructions: [
        {
          key: 'ch1',
          kind: 'rent',
          labelAr: 'شيك 1',
          labelEn: 'Cheque 1',
          amountMinor: 100000,
          currency: 'OMR',
          dueOn: '2026-11-01',
        },
      ],
      chequeSubmissions: [
        {
          key: 'ch1',
          bankName: 'Bank',
          accountHolderName: 'A',
          accountNumber: '1234',
          chequeNumber: '1',
          file: {
            eventId: 'f',
            name: 'ch.jpg',
            mime: 'image/jpeg',
            size: 10,
            submittedAt: paid.esignSignedAt,
          },
          status: 'rejected',
          note: 'غير واضح',
          autoApproved: false,
        },
      ],
      customerDocumentsSentAt: null,
    };
    expect(leaseJourneyPhase({ ...paid, lifecycle })).toBe('awaiting_documents');
    expect(phaseWaitsOn('awaiting_documents')).toBe('customer');
  });

  it('titles the bell item for payment checks and document verification', () => {
    const item: PendingApprovalItem = {
      kind: 'lease_reservation',
      id: 'r',
      reference: 'BK-1',
      propertyId: 'p',
      propertyNameAr: 'عقار',
      propertyNameEn: null,
      unitCode: null,
      party: null,
      contractType: 'lease',
      fromOn: null,
      requestedAt: paid.depositPaidAt,
      phase: 'awaiting_payment_review',
    };
    expect(pendingApprovalTitle(item, true)).toContain('أكّد استلام العربون');
    expect(
      pendingApprovalTitle(
        { ...item, phase: 'awaiting_tenant_signature', verifyDocuments: true },
        true,
      ),
    ).toContain('قُبلت إلكترونياً');
  });
});
