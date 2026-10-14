import type { PendingApprovals } from '@/lib/pending-approvals-shared';

/** A row of `approval_requests`: a contract, expense or work order held for a decision. */
export type ApprovalRequestRow = {
  id: string;
  reference: string;
  type: string;
  subject: string;
  resourceType: string;
  resourceId: string;
  /** `pending`, `on_hold`, `approved` or `rejected`. */
  status: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Contract, expense or work order reference. */
  targetReference: string | null;
  amountMinor: string | null;
  currency: string | null;
  propertyId: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  unitCode: string | null;
};

/** An e-signature with the serial printed on the contract (ES-YYYY-NNNNNN). */
export type SignatureRegisterEntry = {
  id: string;
  serial: string;
  kind: 'contract' | 'reservation';
  /** Contract id, or reservation id for a booking e-sign. */
  parentId: string;
  reference: string | null;
  contractType: 'lease' | 'sale' | null;
  signer: string | null;
  signerRole: string;
  method: string;
  signedAt: string;
  propertyId: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  unitCode: string | null;
  /** Public verification page of a signed contract. */
  verifyUrl: string | null;
};

export type ApprovalsHub = {
  pending: PendingApprovals;
  requests: ApprovalRequestRow[];
  signatures: SignatureRegisterEntry[];
  canDecide: boolean;
  canReadSignatures: boolean;
};

/** Contract requests are settled by signing the contract, not by a bare approval. */
export function decidableInHub(row: ApprovalRequestRow): boolean {
  return row.status === 'pending' && row.resourceType !== 'contract';
}

export function approvalTypeLabel(row: ApprovalRequestRow, ar: boolean): string {
  if (row.resourceType === 'contract') return ar ? 'اعتماد عقد' : 'Contract approval';
  if (row.resourceType === 'expense') return ar ? 'اعتماد مصروف' : 'Expense approval';
  if (row.resourceType === 'maintenance_work_order') {
    return ar ? 'اعتماد أمر صيانة' : 'Work order approval';
  }
  return ar ? 'طلب اعتماد' : 'Approval request';
}

export function approvalStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'pending':
      return ar ? 'بانتظار القرار' : 'Pending';
    case 'on_hold':
      return ar ? 'بانتظار خطوة سابقة' : 'On hold';
    case 'approved':
      return ar ? 'معتمد' : 'Approved';
    case 'rejected':
      return ar ? 'مرفوض' : 'Rejected';
    default:
      return status;
  }
}

export function signerRoleLabel(role: string, ar: boolean): string {
  switch (role) {
    case 'owner':
      return ar ? 'المالك' : 'Owner';
    case 'tenant':
      return ar ? 'المستأجر / المشتري' : 'Tenant / buyer';
    case 'guest':
      return ar ? 'الضيف' : 'Guest';
    default:
      return role;
  }
}

export function signatureMethodLabel(method: string, ar: boolean): string {
  switch (method) {
    case 'booking_confirmation':
      return ar ? 'تأكيد الحجز' : 'Booking confirmation';
    case 'booking_terms_acceptance':
      return ar ? 'قبول شروط الحجز' : 'Booking terms accepted';
    case 'reservation_contract_esign':
    case 'reservation_esign':
      return ar ? 'توقيع إلكتروني على العقد' : 'Contract e-signature';
    case 'system_on_approval':
      return ar ? 'اعتماد المالك' : 'Owner approval';
    default:
      return ar ? 'توقيع إلكتروني' : 'E-signature';
  }
}
