/**
 * After the deposit: owner approval → required documents and the final contract
 * → contract approved by the owner, then signed by the tenant → handover.
 * Everything lives on the reservation's terms snapshot under `lifecycle`.
 */

export type RequirementStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export type ReservationRequirement = {
  code: string;
  labelAr: string;
  labelEn: string;
  status: RequirementStatus;
  /** Owner note on a rejected document, read by the customer. */
  note?: string | null;
  file?: {
    eventId: string;
    name: string;
    mime: string;
    size: number;
    submittedAt: string;
  } | null;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
};

export type ReservationSaleDraft = {
  signedOn: string;
  amount: string;
  notes?: string | undefined;
};

export type ReservationLifecycle = {
  approval?: { at: string; byUserId: string; byName: string | null };
  contractDraft?: {
    savedAt: string;
    byName: string | null;
    /** Rent: the manual lease form payload. Sale: price and signing date. */
    lease?: Record<string, unknown>;
    sale?: ReservationSaleDraft;
  };
  requirements?: ReservationRequirement[];
  contract?: { id: string; reference: string; issuedAt: string; byName: string | null };
  tenantSignature?: { signedAt: string; evidenceEventId: string };
  handover?: {
    at: string;
    on: string;
    byName: string | null;
    recipientName: string;
    keys: string | null;
    electricityReading: string | null;
    waterReading: string | null;
    notes: string | null;
  };
};

export const REQUIREMENT_CATALOGUE: ReadonlyArray<{
  code: string;
  labelAr: string;
  labelEn: string;
  rent: boolean;
  sale: boolean;
}> = [
  {
    code: 'civil_id',
    labelAr: 'البطاقة الشخصية',
    labelEn: 'Civil ID card',
    rent: true,
    sale: true,
  },
  { code: 'passport', labelAr: 'جواز السفر', labelEn: 'Passport', rent: true, sale: true },
  {
    code: 'resident_card',
    labelAr: 'بطاقة الإقامة',
    labelEn: 'Residence card',
    rent: true,
    sale: true,
  },
  {
    code: 'salary_certificate',
    labelAr: 'شهادة راتب',
    labelEn: 'Salary certificate',
    rent: true,
    sale: true,
  },
  {
    code: 'bank_statement',
    labelAr: 'كشف حساب بنكي',
    labelEn: 'Bank statement',
    rent: true,
    sale: true,
  },
  {
    code: 'employment_letter',
    labelAr: 'رسالة من جهة العمل',
    labelEn: 'Employer letter',
    rent: true,
    sale: false,
  },
  {
    code: 'commercial_register',
    labelAr: 'السجل التجاري',
    labelEn: 'Commercial register',
    rent: true,
    sale: true,
  },
  {
    code: 'authorization_letter',
    labelAr: 'تفويض المفوّض بالتوقيع',
    labelEn: 'Signatory authorisation',
    rent: true,
    sale: true,
  },
  {
    code: 'guarantor_id',
    labelAr: 'بطاقة الكفيل أو الضامن',
    labelEn: "Guarantor's ID",
    rent: true,
    sale: false,
  },
  {
    code: 'financing_approval',
    labelAr: 'موافقة التمويل البنكي',
    labelEn: 'Bank financing approval',
    rent: false,
    sale: true,
  },
];

/** Uploaded document limits: the data URL stays under ~1.2 MB so a request fits the body cap. */
export const REQUIREMENT_FILE_MAX_CHARS = 1_600_000;
export const REQUIREMENT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export type LeaseJourneyPhase =
  | 'awaiting_payment'
  | 'awaiting_terms_signature'
  | 'awaiting_owner_approval'
  | 'awaiting_contract_draft'
  | 'awaiting_documents'
  | 'awaiting_documents_review'
  | 'awaiting_contract_approval'
  | 'awaiting_tenant_signature'
  | 'awaiting_handover'
  | 'handed_over'
  | 'closed';

export type LeaseJourneyStage = 'booking' | 'approval' | 'documents' | 'contract' | 'handover';

export const LEASE_JOURNEY_STAGES: readonly LeaseJourneyStage[] = [
  'booking',
  'approval',
  'documents',
  'contract',
  'handover',
];

export type LeaseJourneyInput = {
  status: string;
  depositPaidAt: string | null;
  esignSignedAt: string | null;
  lifecycle: ReservationLifecycle | null | undefined;
};

export function requirementsOf(lifecycle: ReservationLifecycle | null | undefined) {
  return lifecycle?.requirements ?? [];
}

export function lifecycleOf(snapshot: unknown): ReservationLifecycle {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const value = (snapshot as { lifecycle?: unknown }).lifecycle;
  return value && typeof value === 'object' ? value : {};
}

/** Where the booking stands and whose move it is. */
export function leaseJourneyPhase(input: LeaseJourneyInput): LeaseJourneyPhase {
  const life = input.lifecycle ?? {};
  if (life.handover) return 'handed_over';
  if (life.tenantSignature) return 'awaiting_handover';
  if (input.status === 'cancelled' || input.status === 'expired') return 'closed';
  if (!input.depositPaidAt) return input.status === 'pending' ? 'awaiting_payment' : 'closed';
  if (!input.esignSignedAt) return 'awaiting_terms_signature';
  if (!life.approval) return 'awaiting_owner_approval';
  if (life.contract) return 'awaiting_tenant_signature';
  if (!life.contractDraft) return 'awaiting_contract_draft';
  const requirements = requirementsOf(life);
  if (requirements.some((item) => item.status === 'pending' || item.status === 'rejected')) {
    return 'awaiting_documents';
  }
  if (requirements.some((item) => item.status === 'submitted')) return 'awaiting_documents_review';
  return 'awaiting_contract_approval';
}

const PHASE_STAGE: Record<LeaseJourneyPhase, number> = {
  awaiting_payment: 0,
  awaiting_terms_signature: 0,
  awaiting_owner_approval: 1,
  awaiting_contract_draft: 2,
  awaiting_documents: 2,
  awaiting_documents_review: 2,
  awaiting_contract_approval: 3,
  awaiting_tenant_signature: 3,
  awaiting_handover: 4,
  handed_over: 5,
  closed: -1,
};

/** Index of the current stage (0–4); 5 once the premises are handed over, -1 when closed. */
export function leaseJourneyStageIndex(phase: LeaseJourneyPhase): number {
  return PHASE_STAGE[phase];
}

export function phaseWaitsOn(phase: LeaseJourneyPhase): 'customer' | 'owner' | null {
  switch (phase) {
    case 'awaiting_payment':
    case 'awaiting_terms_signature':
    case 'awaiting_documents':
    case 'awaiting_tenant_signature':
      return 'customer';
    case 'awaiting_owner_approval':
    case 'awaiting_contract_draft':
    case 'awaiting_documents_review':
    case 'awaiting_contract_approval':
    case 'awaiting_handover':
      return 'owner';
    default:
      return null;
  }
}

export function leaseJourneyStageLabels(sale: boolean, ar: boolean): string[] {
  if (ar) {
    return [
      'إتمام الحجز',
      'اعتماد المالك',
      'المستندات',
      sale ? 'عقد البيع' : 'عقد الإيجار',
      'تسليم العقار',
    ];
  }
  return [
    'Booking',
    'Owner approval',
    'Documents',
    sale ? 'Sale contract' : 'Lease contract',
    'Handover',
  ];
}

/** Short owner-facing status for the bookings list and the reservation header. */
export function leasePhaseLabel(phase: LeaseJourneyPhase, ar: boolean): string {
  const labels: Record<LeaseJourneyPhase, [string, string]> = {
    awaiting_payment: ['بانتظار دفع العربون', 'Awaiting deposit'],
    awaiting_terms_signature: ['بانتظار توقيع العميل', 'Awaiting client signature'],
    awaiting_owner_approval: ['بانتظار اعتمادك للحجز', 'Awaiting your approval'],
    awaiting_contract_draft: ['معتمد — جهّز العقد', 'Approved — prepare the contract'],
    awaiting_documents: ['بانتظار مستندات العميل', 'Awaiting client documents'],
    awaiting_documents_review: ['مستندات بانتظار مراجعتك', 'Documents to review'],
    awaiting_contract_approval: ['جاهز لاعتماد العقد', 'Ready for contract approval'],
    awaiting_tenant_signature: ['بانتظار توقيع الطرف الثاني', 'Awaiting second-party signature'],
    awaiting_handover: ['عقد موقّع — بانتظار التسليم', 'Signed — awaiting handover'],
    handed_over: ['تم تسليم العقار', 'Handed over'],
    closed: ['مغلق', 'Closed'],
  };
  return labels[phase][ar ? 0 : 1];
}
